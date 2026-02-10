import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

/* =========================================================
   START OR AUTO-JOIN GAME SESSION
   ========================================================= */
export const startGameSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const userId = request.auth.uid;

  return await db.runTransaction(async (tx) => {
    // 1️⃣ Try to find an open session
    const openSnap = await tx.get(
      db
        .collection("game_sessions")
        .where("status", "==", "open")
        .limit(1)
    );

    // 2️⃣ Join existing open session
    if (!openSnap.empty) {
      const doc = openSnap.docs[0];
      const session = doc.data();

      if (session.createdByUserId === userId) {
        throw new HttpsError(
          "failed-precondition",
          "Waiting for another player"
        );
      }

      tx.update(doc.ref, {
        status: "active",
        player2Id: userId,
        currentTurnUserId: session.createdByUserId,
        players: {
          ...session.players,
          [userId]: {
            score: 0,
            questionsAnswered: 0,
            usedQuestionIds: [],
          },
        },
      });

      return { sessionId: doc.id, joined: true };
    }

    // 3️⃣ Create new open session
    const sessionRef = db.collection("game_sessions").doc();

    tx.set(sessionRef, {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUserId: userId,
      player1Id: userId,
      player2Id: null,
      status: "open",
      currentTurnUserId: userId,
      turnNumber: 1,
      players: {
        [userId]: {
          score: 0,
          questionsAnswered: 0,
          usedQuestionIds: [],
        },
      },
    });

    return { sessionId: sessionRef.id, joined: false };
  });
});

/* =========================================================
   ASSIGN NEXT QUESTION (SERVER IS SOURCE OF TRUTH)
   ========================================================= */
export const getNextQuestion = onCall(async (request) => {
  const context = request.auth;
  const { sessionId } = request.data;

  if (!context) {
    throw new HttpsError("unauthenticated", "Login required");
  }
  if (!sessionId) {
    throw new HttpsError("invalid-argument", "Missing sessionId");
  }

  const userId = context.uid;
  const sessionRef = db.collection("game_sessions").doc(sessionId);

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

    // 🔒 Question already assigned
    if (session.currentQuestionId) {
      return { ok: true };
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
        "No available questions"
      );
    }

    const selected =
      available[Math.floor(Math.random() * available.length)];

    // 🔥 AUTHORITATIVE WRITE
    tx.update(sessionRef, {
      currentQuestionId: selected.id,
      currentQuestionStartedAt:
        admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  });
});

/* =========================================================
   SUBMIT ANSWER + TURN LOOP
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

    const qSnap = await tx.get(questionRef);
    if (!qSnap.exists) {
      throw new HttpsError("not-found", "Question not found");
    }

    const correct =
      qSnap.data()!.answer.canonical
        .toLowerCase()
        .trim() ===
      answerText.toLowerCase().trim();

    const playerIds = Object.keys(session.players);
    const nextTurnUserId =
      playerIds.find((id) => id !== userId)!;

    const currentScore =
      session.players[userId].score ?? 0;

    const nextTurnNumber = (session.turnNumber ?? 0) + 1;
    const MAX_TURNS = 10;
    const gameFinished = nextTurnNumber >= MAX_TURNS;

    const updates: any = {
      currentQuestionId:
        admin.firestore.FieldValue.delete(),
      currentQuestionStartedAt:
        admin.firestore.FieldValue.delete(),
      turnNumber: nextTurnNumber,
      [`players.${userId}.score`]:
        currentScore + (correct ? 1 : 0),
      [`players.${userId}.usedQuestionIds`]:
        admin.firestore.FieldValue.arrayUnion(questionId),
    };

    if (gameFinished) {
      updates.status = "finished";
      updates.finishedAt =
        admin.firestore.FieldValue.serverTimestamp();
    } else {
      updates.currentTurnUserId = nextTurnUserId;
    }

    tx.update(sessionRef, updates);

    return {
      isCorrect: correct,
      yourScore:
        currentScore + (correct ? 1 : 0),
      gameFinished,
    };
  });
});