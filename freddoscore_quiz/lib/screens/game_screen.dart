import 'package:flutter/material.dart';
import '../services/game_service.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final GameService _gameService = GameService();

  String? sessionId;
  bool loading = false;
  String message = '';

  Future<void> startGame() async {
    setState(() {
      loading = true;
      message = '';
    });

    try {
      sessionId = await _gameService.startGame();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Game')),
      body: Center(
        child: loading
            ? const CircularProgressIndicator()
            : sessionId == null
            ? ElevatedButton(
                onPressed: startGame,
                child: const Text('Start Game'),
              )
            : Text(message, style: const TextStyle(fontSize: 18)),
      ),
    );
  }
}
