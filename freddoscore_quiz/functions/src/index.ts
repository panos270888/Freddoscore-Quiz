import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

admin.initializeApp();
const db = getFirestore();

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

/**
 * =============================
 * AUTH HELPER (LOCKED)
 * =============================
 */
function getUserId(request: any): string {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "User must be authenticated"
    );
  }
  return uid;
}

/**
 * =============================
 * START GAME SESSION
 * =============================
 */
export const startGameSession = onCall(async (request) => {
  const userA = getUserId(request);
  const { opponentUserId } = request.data ?? {};

  if (!opponentUserId) {
    throw new HttpsError(
      "invalid-argument",
      "Missing opponentUserId"
    );
  }

  if (opponentUserId === userA) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot play against yourself"
    );
  }

  const sessionRef = db.collection("game_sessions").doc();

  await sessionRef.set({
    createdAt: FieldValue.serverTimestamp(),
    createdByUserId: userA,
    status: "active",
    player1Id: userA,
    player2Id: opponentUserId,
    currentTurnUserId: userA,
    turnNumber: 1,
    players: {
      [userA]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
      [opponentUserId]: {
        score: 0,
        questionsAnswered: 0,
        usedQuestionIds: [],
      },
    },
  });

  console.log("Game session created:", sessionRef.id);

  return {
    sessionId: sessionRef.id,
    status: "active",
  };
});

/**
 * =============================
 * JOIN GAME SESSION
 * =============================
 */
export const joinGameSession = onCall(async (request) => {
  const userId = getUserId(request);
  const { sessionId } = request.data ?? {};

  if (!sessionId) {
    throw new HttpsError(
      "invalid-argument",
      "Missing sessionId"
    );
  }

  const snap = await db
    .collection("game_sessions")
    .doc(sessionId)
    .get();

  if (!snap.exists) {
    throw new HttpsError(
      "not-found",
      "Game session not found"
    );
  }

  console.log("User joined game session:", userId);

  return { ok: true };
});

/**
 * =============================
 * GET NEXT QUESTION
 * =============================
 */
export const getNextQuestion = onCall(async (request) => {
  const userId = getUserId(request);
  const { sessionId } = request.data ?? {};

  if (!sessionId) {
    throw new HttpsError(
      "invalid-argument",
      "Missing sessionId"
    );
  }

  return await db.runTransaction(async (tx) => {
    const sessionRef = db.collection("game_sessions").doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);

    if (!sessionSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Game session not found"
      );
    }

    const session = sessionSnap.data()!;

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "Not your turn"
      );
    }

    if (session.currentQuestionId) {
      throw new HttpsError(
        "failed-precondition",
        "Question already active"
      );
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
      throw new HttpsError(
        "failed-precondition",
        "No available questions"
      );
    }

    const selected = available[0]; // deterministic v1
    const q = selected.data();

    tx.update(sessionRef, {
      currentQuestionId: selected.id,
      currentQuestionStartedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      "Question served",
      selected.id,
      "to",
      userId
    );

    return {
      questionId: selected.id,
      text: q.text,
      hints: [
        q.hint1,
        q.hint2,
        q.hint3,
      ].filter(Boolean),
    };
  });
});

/**
 * =============================
 * SUBMIT ANSWER
 * =============================
 */
export const submitAnswer = onCall(async (request) => {
  const userId = getUserId(request);
  const { sessionId, questionId, answerText } =
    request.data ?? {};

  if (!sessionId || !questionId || !answerText) {
    throw new HttpsError(
      "invalid-argument",
      "Missing required fields"
    );
  }

  return await db.runTransaction(async (tx) => {
    const sessionRef = db.collection("game_sessions").doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);

    if (!sessionSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Game session not found"
      );
    }

    const session = sessionSnap.data()!;

    if (session.currentTurnUserId !== userId) {
      throw new HttpsError(
        "permission-denied",
        "Not your turn"
      );
    }

    if (session.currentQuestionId !== questionId) {
      throw new HttpsError(
        "failed-precondition",
        "Question mismatch"
      );
    }

    const questionRef = db
      .collection("questions")
      .doc(questionId);
    const questionSnap = await tx.get(questionRef);

    if (!questionSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Question not found"
      );
    }

    const question = questionSnap.data()!;
    const correct =
      answerText.trim().toLowerCase() ===
      question.answer.canonical
        .toLowerCase()
        .trim();

    const player = session.players[userId];
    const nextTurnUserId =
      session.player1Id === userId
        ? session.player2Id
        : session.player1Id;

    tx.update(sessionRef, {
      [`players.${userId}.score`]:
        player.score + (correct ? 1 : 0),
      [`players.${userId}.questionsAnswered`]:
        player.questionsAnswered + 1,
      [`players.${userId}.usedQuestionIds`]: [
        ...(player.usedQuestionIds ?? []),
        questionId,
      ],
      currentTurnUserId: nextTurnUserId,
      currentQuestionId: FieldValue.delete(),
      currentQuestionStartedAt: FieldValue.delete(),
      turnNumber: session.turnNumber + 1,
    });

    console.log(
      "Answer submitted by",
      userId,
      "correct:",
      correct
    );

    return {
      isCorrect: correct,
      nextTurnUserId,
    };
  });
});