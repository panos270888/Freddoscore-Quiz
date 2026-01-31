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
  const auth = request.auth;

  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = auth.uid;
  const sessionRef = db.collection("game_sessions").doc();

  await db.runTransaction(async (tx) => {
    tx.set(sessionRef, {
      status: "waiting",
      createdByUserId: userId,

      player1Id: userId,
      player2Id: null,

      currentTurnUserId: userId,
      turnNumber: 1,

      players: {
        [userId]: {
          score: 0,
          questionsAnswered: 0,
          usedQuestionIds: [],
        },
      },

      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { sessionId: sessionRef.id };
});

/* =========================================================
   JOIN GAME SESSION
========================================================= */
export const joinGameSession = onCall(async (request) => {
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

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);

    if (!snap.exists) {
      throw new HttpsError("not-found", "Session not found");
    }

    const session = snap.data()!;

    if (session.status !== "waiting") {
      throw new HttpsError("failed-precondition", "Game already started");
    }

    if (session.player1Id === userId) {
      throw new HttpsError(
        "failed-precondition",
        "Creator cannot join their own game"
      );
    }

    tx.update(sessionRef, {
      player2Id: userId,
      status: "active",
      [`players.${userId}`]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    });
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

  const userId = auth.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Game not found");
    }

    const session = sessionSnap.data()!;

    if (session.status !== "active") {
      throw new HttpsError("failed-precondition", "Game not active");
    }

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError("permission-denied", "Not your turn");
    }

    const usedIds =
      session.players?.[userId]?.usedQuestionIds ?? [];

    const questionsSnap = await db
      .collection("questions")
      .where("metadata.isActive", "==", true)
      .get();

    const available = questionsSnap.docs.filter(
      (q) => !usedIds.includes(q.id)
    );

    if (available.length === 0) {
      throw new HttpsError("failed-precondition", "No questions left");
    }

    const selected =
      available[Math.floor(Math.random() * available.length)];

    tx.update(sessionRef, {
      currentQuestionId: selected.id,
    });

    return {
      questionId: selected.id,
      text: selected.data().text,
      hints: selected.data().hints.slice(0, 3),
    };
  });
});

/* =========================================================
   SUBMIT ANSWER
========================================================= */
export const submitAnswer = onCall(async (request) => {
  const auth = request.auth;
  const { sessionId, questionId, answerText } = request.data;

  if (!auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  const userId = auth.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);
  const questionRef = db.collection("questions").doc(questionId);

  return await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Game not found");
    }

    const session = sessionSnap.data()!;

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError("permission-denied", "Not your turn");
    }

    const qSnap = await tx.get(questionRef);
    if (!qSnap.exists) {
      throw new HttpsError("not-found", "Question not found");
    }

    const correct =
      qSnap
        .data()!
        .answer.canonical.toLowerCase()
        .trim() ===
      answerText.toLowerCase().trim();

    const nextTurnUserId =
      session.player1Id === userId
        ? session.player2Id
        : session.player1Id;

    tx.update(sessionRef, {
      currentTurnUserId: nextTurnUserId,
      turnNumber: session.turnNumber + 1,
      currentQuestionId: admin.firestore.FieldValue.delete(),
      [`players.${userId}.score`]:
        session.players[userId].score + (correct ? 1 : 0),
      [`players.${userId}.usedQuestionIds`]:
        admin.firestore.FieldValue.arrayUnion(questionId),
    });

    return {
      isCorrect: correct,
      yourScore:
        session.players[userId].score + (correct ? 1 : 0),
    };
  });
});