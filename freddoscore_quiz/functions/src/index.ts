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

export const getNextQuestion = onCall(async (request) => {
  const context = request.auth;
  const data = request.data;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.uid;
  const { sessionId } = data;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const sessionRef = db.collection("game_sessions").doc(sessionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);

    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "GameSession not found");
    }

    const session = sessionSnap.data()!;

    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Game is not active");
    }

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError("permission-denied", "Not your turn");
    }

    if (session.currentQuestionId) {
      throw new HttpsError(
        "failed-precondition",
        "Question already fetched for this turn"
      );
    }

    const usedIds =
      session.players?.[userId]?.usedQuestionIds ?? [];

    const questionsSnap = await db
      .collection("questions")
      .where("metadata.isActive", "==", true)
      .get();

    const available = questionsSnap.docs.filter(
      (doc) => !usedIds.includes(doc.id)
    );

    if (available.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "No available questions left"
      );
    }

    const selected =
      available[Math.floor(Math.random() * available.length)];

    tx.update(sessionRef, {
      currentQuestionId: selected.id,
      currentQuestionStartedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    const q = selected.data();

    return {
      questionId: selected.id,
      text: q.text,
      hints: q.hints.slice(0, 3),
    };
  });
});