import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

final FirebaseFunctions functions = FirebaseFunctions.instanceFor(
  region: 'us-central1',
);

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  String? sessionId;
  bool loading = false;
  bool answering = false;

  String? localQuestionId;
  String? questionText;
  List<String> hints = [];
  int myScore = 0;

  final TextEditingController _answerController = TextEditingController();

  String get myUserId => FirebaseAuth.instance.currentUser!.uid;

  /* =========================
     START / AUTO-JOIN
     ========================= */

  Future<void> startGame() async {
    setState(() => loading = true);

    final result = await functions.httpsCallable('startGameSession').call();

    setState(() {
      sessionId = result.data['sessionId'];
      loading = false;
    });
  }

  /* =========================
     QUESTION FLOW
     ========================= */

  Future<void> requestQuestion() async {
    if (answering) return;

    setState(() => answering = true);

    await functions.httpsCallable('getNextQuestion').call({
      'sessionId': sessionId,
    });

    setState(() => answering = false);
  }

  Future<void> submitAnswer(String questionId) async {
    setState(() => answering = true);

    final result = await functions.httpsCallable('submitAnswer').call({
      'sessionId': sessionId,
      'questionId': questionId,
      'answerText': _answerController.text.trim(),
    });

    setState(() {
      myScore = result.data['yourScore'];
      _answerController.clear();
      localQuestionId = null;
      questionText = null;
      hints = [];
      answering = false;
    });
  }

  /* =========================
     UI
     ========================= */

  @override
  Widget build(BuildContext context) {
    // LOBBY
    if (sessionId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Game')),
        body: Center(
          child: loading
              ? const CircularProgressIndicator()
              : ElevatedButton(
                  onPressed: startGame,
                  child: const Text('Start Game'),
                ),
        ),
      );
    }

    // SESSION LISTENER
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('game_sessions')
          .doc(sessionId)
          .snapshots(),
      builder: (context, sessionSnap) {
        if (!sessionSnap.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final session = sessionSnap.data!.data() as Map<String, dynamic>;

        final status = session['status'];
        final currentTurnUserId = session['currentTurnUserId'];
        final firestoreQuestionId = session['currentQuestionId'];

        if (status != 'active') {
          return const Scaffold(
            body: Center(child: Text('Waiting for opponent...')),
          );
        }

        final isMyTurn = currentTurnUserId == myUserId;

        // 🔥 DETERMINISTIC QUESTION REQUEST
        if (isMyTurn && firestoreQuestionId == null && !answering) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            requestQuestion();
          });
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(isMyTurn ? 'Your turn' : "Opponent’s turn"),
          ),
          body: firestoreQuestionId == null
              ? const Center(child: CircularProgressIndicator())
              : StreamBuilder<DocumentSnapshot>(
                  stream: FirebaseFirestore.instance
                      .collection('questions')
                      .doc(firestoreQuestionId)
                      .snapshots(),
                  builder: (context, qSnap) {
                    if (!qSnap.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }

                    final q = qSnap.data!.data() as Map<String, dynamic>;

                    final question = q['text'];
                    final qHints = [
                      q['hint1'],
                      q['hint2'],
                      q['hint3'],
                    ].whereType<String>().toList();

                    return Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Score: $myScore',
                            style: const TextStyle(fontSize: 16),
                          ),
                          const SizedBox(height: 12),

                          // QUESTION (VISIBLE TO BOTH)
                          Text(question, style: const TextStyle(fontSize: 18)),
                          const SizedBox(height: 12),

                          ...qHints.map((h) => Text('• $h')),

                          const SizedBox(height: 16),

                          if (isMyTurn) ...[
                            TextField(
                              controller: _answerController,
                              decoration: const InputDecoration(
                                labelText: 'Your answer',
                              ),
                            ),
                            const SizedBox(height: 12),
                            ElevatedButton(
                              onPressed: answering
                                  ? null
                                  : () => submitAnswer(firestoreQuestionId),
                              child: const Text('Submit'),
                            ),
                          ] else
                            const Text(
                              'Waiting for opponent to answer…',
                              style: TextStyle(fontStyle: FontStyle.italic),
                            ),
                        ],
                      ),
                    );
                  },
                ),
        );
      },
    );
  }

  @override
  void dispose() {
    _answerController.dispose();
    super.dispose();
  }
}
