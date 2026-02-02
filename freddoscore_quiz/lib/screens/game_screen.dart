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

  String? questionId;
  String? questionText;
  bool answering = false;
  int myScore = 0;

  String get myUserId => FirebaseAuth.instance.currentUser!.uid;

  /* =========================
     GAME SESSION MANAGEMENT
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

  /* =========================
     QUESTION FLOW
     ========================= */

  Future<void> loadQuestion() async {
    if (answering || questionText != null) return;

    setState(() => answering = true);

    final result = await functions.httpsCallable('getNextQuestion').call({
      'sessionId': sessionId,
    });

    setState(() {
      questionId = result.data['questionId'];
      questionText = result.data['text'];
      answering = false;
    });
  }

  Future<void> submitAnswer() async {
    if (questionId == null) return;

    setState(() => answering = true);

    final result = await functions.httpsCallable('submitAnswer').call({
      'sessionId': sessionId,
      'questionId': questionId,
      'answerText': _answerController.text.trim(),
    });

    setState(() {
      myScore = result.data['yourScore'];
      questionId = null;
      questionText = null;
      _answerController.clear();
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

    // ACTIVE GAME
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('game_sessions')
          .doc(sessionId)
          .snapshots(),
      builder: (context, snapshot) {
        // connection gate
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const Scaffold(body: Center(child: Text('Session not found')));
        }

        final data = snapshot.data!.data() as Map<String, dynamic>;

        final status = data['status'];
        final currentTurnUserId = data['currentTurnUserId'];
        final isMyTurn = currentTurnUserId == myUserId;

        // WAITING FOR OPPONENT
        if (status == 'waiting') {
          return const Scaffold(
            body: Center(
              child: Text(
                'Waiting for opponent...',
                style: TextStyle(fontSize: 20),
              ),
            ),
          );
        }

        // AUTO LOAD QUESTION WHEN MY TURN
        if (isMyTurn && questionText == null && !answering) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            loadQuestion();
          });
        }

        return Scaffold(
          appBar: AppBar(title: const Text('Game')),
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: isMyTurn ? _buildMyTurn() : _buildOpponentTurn(),
          ),
        );
      },
    );
  }

  Widget _buildOpponentTurn() {
    return const Center(
      child: Text('Opponent’s turn', style: TextStyle(fontSize: 24)),
    );
  }

  Widget _buildMyTurn() {
    if (questionText == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Your score: $myScore', style: const TextStyle(fontSize: 16)),
        const SizedBox(height: 12),
        Text(questionText!, style: const TextStyle(fontSize: 18)),
        const SizedBox(height: 16),
        TextField(
          controller: _answerController,
          decoration: const InputDecoration(labelText: 'Your answer'),
        ),
        const SizedBox(height: 16),
        ElevatedButton(
          onPressed: answering ? null : submitAnswer,
          child: const Text('Submit'),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _sessionController.dispose();
    _answerController.dispose();
    super.dispose();
  }
}
