import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

/* =========================================================
   START GAME SESSION (OPEN SESSION)
========================================================= */
export const startGameSession = onCall(async (request) => {
  const context = request.auth;
  if (!context) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const userId = context.uid;
  const sessionRef = db.collection("game_sessions").doc();

  await sessionRef.set({
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdByUserId: userId,
    player1Id: userId,
    status: "waiting",
    turnNumber: 1,
    players: {
      [userId]: {
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

/* =========================================================
   JOIN GAME SESSION
========================================================= */
export const joinGameSession = onCall(async (request) => {
  const context = request.auth;
  if (!context) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const userId = context.uid;
  const { sessionId } = request.data;

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const sessionRef = db.collection("game_sessions").doc(sessionId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Session not found");
    }

    const session = snap.data()!;

    if (session.status !== "waiting") {
      throw new HttpsError("failed-precondition", "Game already started");
    }

    if (session.player1Id === userId) {
      throw new HttpsError("failed-precondition", "Cannot join your own game");
    }

    tx.update(sessionRef, {
      player2Id: userId,
      status: "active",
      currentTurnUserId: session.player1Id,
      [`players.${userId}`]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    });

    return { success: true };
  });
});

/* =========================================================
   GET NEXT QUESTION
========================================================= */
export const getNextQuestion = onCall(async (request) => {
  const auth = request.auth;
  const { sessionId } = request.data;

  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const userId = auth.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);

    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Game session not found");
    }

    const session = sessionSnap.data()!;

    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Game not active");
    }

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError("permission-denied", "Not your turn");
    }

    // get already-used questions
    const usedIds =
      session.players?.[userId]?.usedQuestionIds ?? [];

    // fetch active questions
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
        "No available questions"
      );
    }

    const selected =
      available[Math.floor(Math.random() * available.length)];

    const q = selected.data();

    // 🔴 IMPORTANT: adapt to your current schema
    const hints = [
      q.hint1,
      q.hint2,
      q.hint3,
    ].filter(Boolean);

    // mark question as active for this turn
    tx.update(sessionRef, {
      currentQuestionId: selected.id,
    });

    return {
      questionId: selected.id,
      text: q.text,
      hints,
    };
  });
});

/* =========================================================
   SUBMIT ANSWER
========================================================= */
export const submitAnswer = onCall(async (request) => {
  const context = request.auth;
  const { sessionId, questionId, answerText } = request.data;

  if (!context) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const userId = context.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);
  const questionRef = db.collection("questions").doc(questionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Session not found");
    }

    const session = sessionSnap.data()!;
    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Game not active");
    }

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError("permission-denied", "Not your turn");
    }

    if (session.currentQuestionId !== questionId) {
      throw new HttpsError("failed-precondition", "Invalid question");
    }

    const questionSnap = await tx.get(questionRef);
    if (!questionSnap.exists) {
      throw new HttpsError("not-found", "Question not found");
    }

    const correct =
      answerText.trim().toLowerCase() ===
      questionSnap.data()!.answer.canonical.toLowerCase();

    const playerIds = Object.keys(session.players);
    const nextTurnUserId =
      playerIds.find((id) => id !== userId)!;

    const nextTurnNumber = (session.turnNumber ?? 0) + 1;
    const MAX_TURNS = 10;
    const gameFinished = nextTurnNumber >= MAX_TURNS;

    const updates: any = {
      currentQuestionId: admin.firestore.FieldValue.delete(),
      currentQuestionStartedAt: admin.firestore.FieldValue.delete(),
      turnNumber: nextTurnNumber,
      [`players.${userId}.score`]:
        (session.players[userId].score ?? 0) + (correct ? 1 : 0),
      [`players.${userId}.usedQuestionIds`]:
        admin.firestore.FieldValue.arrayUnion(questionId),
    };

    if (gameFinished) {
      updates.status = "finished";
      updates.finishedAt =
        admin.firestore.FieldValue.serverTimestamp();
    } else {
      // 🔥 THIS WAS MISSING 🔥
      updates.currentTurnUserId = nextTurnUserId;
    }

    tx.update(sessionRef, updates);

    return {
      isCorrect: correct,
      yourScore: updates[`players.${userId}.score`],
      gameFinished,
    };
  });
});