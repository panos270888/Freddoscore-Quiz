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

  final TextEditingController _sessionController = TextEditingController();
  final TextEditingController _answerController = TextEditingController();

  DocumentSnapshot? questionDoc;
  bool answering = false;
  int myScore = 0;

  String get myUserId => FirebaseAuth.instance.currentUser!.uid;

  /* =========================
     SESSION ACTIONS
     ========================= */

  Future<void> startGame() async {
    setState(() => loading = true);
    final result = await functions.httpsCallable('startGameSession').call();
    setState(() {
      sessionId = result.data['sessionId'];
      loading = false;
    });
  }

  Future<void> joinGame() async {
    setState(() => loading = true);
    final id = _sessionController.text.trim();
    await functions.httpsCallable('joinGameSession').call({'sessionId': id});
    setState(() {
      sessionId = id;
      loading = false;
    });
  }

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
      answering = false;
    });
  }

  /* =========================
     UI
     ========================= */

  @override
  Widget build(BuildContext context) {
    if (sessionId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Game MVP')),
        body: Padding(
          padding: const EdgeInsets.all(16),
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    ElevatedButton(
                      onPressed: startGame,
                      child: const Text('Start Game'),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _sessionController,
                      decoration: const InputDecoration(
                        labelText: 'Session ID to join',
                      ),
                    ),
                    ElevatedButton(
                      onPressed: joinGame,
                      child: const Text('Join Game'),
                    ),
                  ],
                ),
        ),
      );
    }

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
        final currentQuestionId = session['currentQuestionId'];

        final isMyTurn = currentTurnUserId == myUserId;

        if (status == 'waiting') {
          return const Scaffold(
            body: Center(child: Text('Waiting for opponent...')),
          );
        }

        // 🔑 ONLY ACTIVE PLAYER REQUESTS QUESTION
        if (isMyTurn && currentQuestionId == null && !answering) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            requestQuestion();
          });
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(isMyTurn ? 'Your turn' : 'Opponent’s turn'),
          ),
          body: currentQuestionId == null
              ? const Center(child: CircularProgressIndicator())
              : StreamBuilder<DocumentSnapshot>(
                  stream: FirebaseFirestore.instance
                      .collection('questions')
                      .doc(currentQuestionId)
                      .snapshots(),
                  builder: (context, qSnap) {
                    if (!qSnap.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }

                    final q = qSnap.data!.data() as Map<String, dynamic>;

                    return Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(q['text'], style: const TextStyle(fontSize: 18)),
                          const SizedBox(height: 12),
                          Text('• ${q['hint1']}'),
                          Text('• ${q['hint2']}'),
                          Text('• ${q['hint3']}'),
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
                                  : () => submitAnswer(currentQuestionId),
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
}
