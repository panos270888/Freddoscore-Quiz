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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    players: {
      [callerId]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    },
  });

  return {
    sessionId: sessionRef.id,
  };
});

/**
 * STEP 2.2.1
 * Questions are NOT allowed until the game is active.
 * This function is intentionally blocked for now.
 */

export const joinGameSession = onCall(async (request) => {
  const context = request.auth;
  const { sessionId } = request.data;

  if (!context) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const userId = context.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);

    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Game session not found");
    }

    const session = sessionSnap.data()!;

    if (session.status !== "waiting") {
      throw new HttpsError(
        "failed-precondition",
        "Game has already started"
      );
    }

    if (session.players?.[userId]) {
      throw new HttpsError(
        "failed-precondition",
        "User already joined"
      );
    }

    const existingPlayerIds = Object.keys(session.players);
    if (existingPlayerIds.length !== 1) {
      throw new HttpsError(
        "failed-precondition",
        "Invalid game state"
      );
    }

    const creatorId = existingPlayerIds[0];

    // Randomly choose starting player
    const startingUserId =
      Math.random() < 0.5 ? creatorId : userId;

    tx.update(sessionRef, {
      status: "active",
      turnNumber: 1,
      currentTurnUserId: startingUserId,
      [`players.${userId}`]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    });

    return {
      status: "active",
      currentTurnUserId: startingUserId,
    };
  });
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