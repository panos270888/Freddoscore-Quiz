import 'dart:async';

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../services/game_service.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final GameService _gameService = GameService();
  final TextEditingController _answerController = TextEditingController();

  StreamSubscription<DocumentSnapshot>? _sessionSub;

  String? sessionId;
  String status = 'idle';
  String? currentTurnUserId;

  String? questionId;
  String? questionText;
  List<String> hints = [];

  int score = 0;
  bool loading = false;
  String message = '';

  // ─────────────────────────────────────────────
  // GAME CREATION
  // ─────────────────────────────────────────────
  Future<void> startGame() async {
    setState(() {
      loading = true;
      message = '';
    });

    try {
      sessionId = await _gameService.startGame();
      status = 'waiting';
      listenToSession();

      setState(() {
        loading = false;
        message = 'Waiting for opponent...';
      });
    } catch (e) {
      setState(() {
        loading = false;
        message = e.toString();
      });
    }
  }

  // ─────────────────────────────────────────────
  // FIRESTORE SESSION LISTENER
  // ─────────────────────────────────────────────
  void listenToSession() {
    final uid = FirebaseAuth.instance.currentUser!.uid;

    _sessionSub = FirebaseFirestore.instance
        .collection('game_sessions')
        .doc(sessionId)
        .snapshots()
        .listen((snap) async {
          if (!snap.exists) return;

          final data = snap.data()!;
          final newStatus = data['status'];
          final turnUserId = data['currentTurnUserId'];

          setState(() {
            status = newStatus;
            currentTurnUserId = turnUserId;
          });

          if (newStatus == 'active' &&
              turnUserId == uid &&
              questionId == null) {
            await loadQuestion();
          }
        });
  }

  // ─────────────────────────────────────────────
  // LOAD QUESTION
  // ─────────────────────────────────────────────
  Future<void> loadQuestion() async {
    setState(() {
      loading = true;
      message = '';
    });

    try {
      final data = await _gameService.getNextQuestion(sessionId!);

      setState(() {
        questionId = data['questionId'];
        questionText = data['text'];
        hints = List<String>.from(data['hints']);
        loading = false;
      });
    } catch (e) {
      setState(() {
        loading = false;
        message = e.toString();
      });
    }
  }

  // ─────────────────────────────────────────────
  // SUBMIT ANSWER
  // ─────────────────────────────────────────────
  Future<void> submitAnswer() async {
    if (questionId == null) return;

    setState(() {
      loading = true;
    });

    try {
      final result = await _gameService.submitAnswer(
        sessionId: sessionId!,
        questionId: questionId!,
        answerText: _answerController.text,
      );

      setState(() {
        score = result['yourScore'];
        message = result['isCorrect']
            ? 'Correct!'
            : 'Wrong! Answer: ${result['correctAnswer']}';
        _answerController.clear();
        questionId = null;
        questionText = null;
        hints = [];
        loading = false;
      });
    } catch (e) {
      setState(() {
        loading = false;
        message = e.toString();
      });
    }
  }

  // ─────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────
  @override
  void dispose() {
    _sessionSub?.cancel();
    _answerController.dispose();
    super.dispose();
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;

    return Scaffold(
      appBar: AppBar(title: const Text('Game')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : sessionId == null
            ? Center(
                child: ElevatedButton(
                  onPressed: startGame,
                  child: const Text('Start Game'),
                ),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Score: $score'),
                  const SizedBox(height: 12),

                  // STATUS
                  if (status == 'waiting')
                    const Text(
                      'Waiting for opponent...',
                      style: TextStyle(fontSize: 18),
                    ),

                  if (status == 'active' && currentTurnUserId != uid)
                    const Text(
                      "Opponent's turn",
                      style: TextStyle(fontSize: 18),
                    ),

                  if (status == 'active' &&
                      currentTurnUserId == uid &&
                      questionText != null) ...[
                    Text(questionText!, style: const TextStyle(fontSize: 18)),
                    const SizedBox(height: 8),
                    ...hints.map((h) => Text('• $h')),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _answerController,
                      decoration: const InputDecoration(
                        labelText: 'Your answer',
                      ),
                    ),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: submitAnswer,
                      child: const Text('Submit'),
                    ),
                  ],

                  const SizedBox(height: 12),
                  Text(message),
                ],
              ),
      ),
    );
  }
}
