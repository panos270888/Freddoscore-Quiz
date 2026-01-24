import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

/**
 * STEP 2.2.1
 * Create a new game session in "waiting" state.
 * Only one player exists at this stage.
 */
export const startGameSession = onCall(async (request) => {
  const context = request.auth;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const callerId = context.uid;
  const sessionRef = db.collection("game_sessions").doc();

  await sessionRef.set({
    status: "waiting",
    createdByUserId: callerId,
    players: {
      [callerId]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    sessionId: sessionRef.id,
    status: "waiting",
  };
});

/**
 * STEP 2.2.1
 * Questions are NOT allowed until the game is active.
 * This function is intentionally blocked for now.
 */

export const joinGameSession = onCall(async (request) => {
  const context = request.auth;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = context.uid;
  const { sessionId } = request.data;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const sessionRef = db.collection("game_sessions").doc(sessionId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", "GameSession not found");
    }

    const session = snap.data()!;

    if (session.status !== "waiting") {
      throw new HttpsError(
        "failed-precondition",
        "Game is not waiting for players"
      );
    }

    if (session.players[userId]) {
      throw new HttpsError(
        "failed-precondition",
        "User already in game"
      );
    }

    const creatorId = session.createdByUserId;

    //const playerIds = [creatorId, userId];
    const startingUserId =
      Math.random() < 0.5 ? creatorId : userId;

    tx.update(sessionRef, {
      status: "active",
      player1Id: creatorId,
      player2Id: userId,
      currentTurnUserId: startingUserId,
      turnNumber: 1,
      [`players.${userId}`]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    });
  });

  return { success: true };
});

export const getNextQuestion = onCall(async (request) => {
  const context = request.auth;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { sessionId } = request.data;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const sessionRef = db.collection("game_sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "GameSession not found");
  }

  const session = sessionSnap.data()!;

  if (session.status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "Game has not started yet"
    );
  }

  // This line will only be reached in Step 2.2.2+
  throw new HttpsError(
    "failed-precondition",
    "Question logic not enabled yet"
  );
});

/**
 * STEP 2.2.1
 * Answer submission is NOT allowed until the game is active.
 */
export const submitAnswer = onCall(async (request) => {
  const context = request.auth;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const { sessionId } = request.data;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const sessionRef = db.collection("game_sessions").doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "GameSession not found");
  }

  const session = sessionSnap.data()!;

  if (session.status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "Game has not started yet"
    );
  }

  // Will be implemented in Step 2.2.3
  throw new HttpsError(
    "failed-precondition",
    "Answer submission not enabled yet"
  );
});