import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_functions/cloud_functions.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  String? sessionId;
  bool loading = false;
  String message = '';

  final _sessionController = TextEditingController();

  String get myUserId => FirebaseAuth.instance.currentUser!.uid;

  Future<void> startGame() async {
    setState(() => loading = true);

    final result = await FirebaseFunctions.instance
        .httpsCallable('startGameSession')
        .call({'opponentUserId': 'TEMP', 'proximityCode': 'TESTCODE'});

    setState(() {
      sessionId = result.data['sessionId'];
      loading = false;
    });
  }

  Future<void> joinGame() async {
    setState(() => loading = true);

    await FirebaseFunctions.instance.httpsCallable('joinGameSession').call({
      'sessionId': _sessionController.text.trim(),
    });

    setState(() {
      sessionId = _sessionController.text.trim();
      loading = false;
    });
  }

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

    // 🔴 THIS IS THE IMPORTANT PART
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
        final status = data['status'];
        final currentTurnUserId = data['currentTurnUserId'];

        if (status == 'waiting') {
          return Scaffold(
            appBar: AppBar(title: const Text('Game')),
            body: const Center(child: Text('Waiting for opponent...')),
          );
        }

        final isMyTurn = currentTurnUserId == myUserId;

        return Scaffold(
          appBar: AppBar(title: const Text('Game')),
          body: Center(
            child: Text(
              isMyTurn ? 'Your turn!' : 'Opponent’s turn',
              style: const TextStyle(fontSize: 24),
            ),
          ),
        );
      },
    );
  }
}
