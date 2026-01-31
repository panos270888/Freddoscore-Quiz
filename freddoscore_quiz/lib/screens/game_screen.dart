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
  List<String> hints = [];
  int myScore = 0;
  bool answering = false;

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
    if (answering) return;

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

    // 🔥 CRITICAL FIX IS HERE
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('game_sessions')
          .doc(sessionId)
          .snapshots(),
      builder: (context, snapshot) {
        // ✅ FIX #1: wait for connection, not data
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        // ✅ FIX #2: explicit existence check
        if (!snapshot.hasData || !snapshot.data!.exists) {
          return const Scaffold(body: Center(child: Text('Session not found')));
        }

        final data = snapshot.data!.data() as Map<String, dynamic>;
        final status = data['status'];
        final currentTurnUserId = data['currentTurnUserId'];

        // WAITING STATE
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

        final isMyTurn = currentTurnUserId == myUserId;

        // AUTO-LOAD QUESTION ON TURN
        if (isMyTurn && questionText == null && !answering) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            loadQuestion();
          });
        }

        return Scaffold(
          appBar: AppBar(title: const Text('Game')),
          body: Center(
            child: Text(
              isMyTurn ? 'Your turn' : 'Opponent’s turn',
              style: const TextStyle(fontSize: 24),
            ),
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _sessionController.dispose();
    _answerController.dispose();
    super.dispose();
  }
}
