import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
//setGlobalOptions({ maxInstances: 10 });

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

export const startGameSession = onCall(
  async (request) => {
    const context = request.auth;
    const data = request.data;

    if (!context) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }

    const callerId = context.uid;
    const { opponentUserId, proximityCode } = data;

    if (!opponentUserId || !proximityCode) {
      throw new HttpsError(
        "invalid-argument",
        "Missing opponentUserId or proximityCode"
      );
    }

    if (callerId === opponentUserId) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot start game with yourself"
      );
    }

    const proximityRef = db
      .collection("proximity_sessions")
      .doc(proximityCode);

    const sessionRef = db.collection("game_sessions").doc();

    await db.runTransaction(async (tx) => {
      const proximitySnap = await tx.get(proximityRef);

      if (!proximitySnap.exists) {
        throw new HttpsError(
          "not-found",
          "Invalid proximity code"
        );
      }

      const proximity = proximitySnap.data()!;

      if (proximity.used) {
        throw new HttpsError(
          "failed-precondition",
          "Proximity code already used"
        );
      }

      const now = admin.firestore.Timestamp.now();
      if (proximity.expiresAt.toMillis() < now.toMillis()) {
        throw new HttpsError(
          "deadline-exceeded",
          "Proximity code expired"
        );
      }

      const users = [proximity.userAId, proximity.userBId];
      if (!users.includes(callerId) || !users.includes(opponentUserId)) {
        throw new HttpsError(
          "permission-denied",
          "Proximity code does not match users"
        );
      }

      const startingUserId =
        Math.random() < 0.5 ? callerId : opponentUserId;

      tx.set(sessionRef, {
        status: "active",
        player1Id: proximity.userAId,
        player2Id: proximity.userBId,
        currentTurnUserId: startingUserId,
        turnNumber: 1,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        players: {
          [proximity.userAId]: {
            score: 0,
            questionsAnswered: 0,
            usedQuestionIds: [],
          },
          [proximity.userBId]: {
            score: 0,
            questionsAnswered: 0,
            usedQuestionIds: [],
          },
        },
      });

      tx.update(proximityRef, { used: true });
    });

    return {
      sessionId: sessionRef.id,
      status: "active",
    };
  }
);