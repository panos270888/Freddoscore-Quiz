import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

final functions = FirebaseFunctions.instanceFor(region: 'us-central1');

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  String? sessionId;

  bool loading = false;
  bool loadingQuestion = false;

  String error = '';

  String? questionId;
  String? questionText;
  List<String> hints = [];

  final TextEditingController _answerController = TextEditingController();

  String get myUserId => FirebaseAuth.instance.currentUser!.uid;

  /* ============================
     START GAME (LOCKED MVP)
  ============================ */

  Future<void> startGame() async {
    setState(() {
      loading = true;
      error = '';
    });

    try {
      // Find another logged-in user (temporary MVP logic)
      final usersSnap = await FirebaseFirestore.instance
          .collection('users')
          .get();

      final opponentId = usersSnap.docs
          .map((d) => d.id)
          .firstWhere((id) => id != myUserId, orElse: () => '');

      if (opponentId.isEmpty) {
        throw Exception('No opponent available');
      }

      final result = await functions.httpsCallable('startGameSession').call({
        'opponentUserId': opponentId,
      });

      setState(() {
        sessionId = result.data['sessionId'];
        loading = false;
      });
    } catch (e) {
      setState(() {
        loading = false;
        error = e.toString();
      });
    }
  }

  /* ============================
     LOAD QUESTION
  ============================ */

  Future<void> loadQuestion() async {
    if (loadingQuestion || sessionId == null) return;

    setState(() {
      loadingQuestion = true;
    });

    try {
      final result = await functions.httpsCallable('getNextQuestion').call({
        'sessionId': sessionId,
      });

      setState(() {
        questionId = result.data['questionId'];
        questionText = result.data['text'];
        hints = List<String>.from(result.data['hints']);
        loadingQuestion = false;
      });
    } catch (e) {
      setState(() {
        loadingQuestion = false;
        error = e.toString();
      });
    }
  }

  /* ============================
     SUBMIT ANSWER
  ============================ */

  Future<void> submitAnswer() async {
    if (questionId == null) return;

    setState(() {
      loadingQuestion = true;
    });

    try {
      await functions.httpsCallable('submitAnswer').call({
        'sessionId': sessionId,
        'questionId': questionId,
        'answerText': _answerController.text.trim(),
      });

      setState(() {
        questionId = null;
        questionText = null;
        hints = [];
        _answerController.clear();
        loadingQuestion = false;
      });
    } catch (e) {
      setState(() {
        loadingQuestion = false;
        error = e.toString();
      });
    }
  }

  /* ============================
     UI
  ============================ */

  @override
  Widget build(BuildContext context) {
    // LOBBY
    if (sessionId == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Game MVP')),
        body: Center(
          child: loading
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ElevatedButton(
                      onPressed: startGame,
                      child: const Text('Start Game'),
                    ),
                    if (error.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(error, style: const TextStyle(color: Colors.red)),
                    ],
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
        if (!snapshot.hasData) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final data = snapshot.data!.data() as Map<String, dynamic>;
        final currentTurnUserId = data['currentTurnUserId'];
        final currentQuestionId = data['currentQuestionId'];

        final isMyTurn = currentTurnUserId == myUserId;

        // 🔥 AUTO-LOAD QUESTION WHEN IT'S MY TURN
        if (isMyTurn &&
            currentQuestionId == null &&
            questionId == null &&
            !loadingQuestion) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            loadQuestion();
          });
        }

        return Scaffold(
          appBar: AppBar(
            title: Text(isMyTurn ? 'Your turn' : 'Opponent’s turn'),
          ),
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
      child: Text('Waiting for opponent...', style: TextStyle(fontSize: 22)),
    );
  }

  Widget _buildMyTurn() {
    if (loadingQuestion) {
      return const Center(child: CircularProgressIndicator());
    }

    if (questionText == null) {
      return const Center(child: Text('Loading question...'));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(questionText!, style: const TextStyle(fontSize: 18)),
        const SizedBox(height: 12),
        ...hints.map((h) => Text('• $h')),
        const SizedBox(height: 12),
        TextField(
          controller: _answerController,
          decoration: const InputDecoration(labelText: 'Your answer'),
        ),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: submitAnswer, child: const Text('Submit')),
        if (error.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(error, style: const TextStyle(color: Colors.red)),
        ],
      ],
    );
  }
}
