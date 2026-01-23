import 'package:flutter/material.dart';
import '../services/game_service.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({super.key});

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  final GameService _gameService = GameService();
  final TextEditingController _answerController = TextEditingController();

  String? sessionId;
  String? questionId;
  String? questionText;
  List<String> hints = [];
  int score = 0;
  bool loading = false;
  String message = '';

  // TEMP values for MVP testing
  final String mockOpponentId = 'OPPONENT_USER_ID';
  final String mockProximityCode = 'TESTCODE';

  Future<void> startGame() async {
    setState(() => loading = true);

    try {
      sessionId = await _gameService.startGame(
        opponentUserId: mockOpponentId,
        proximityCode: mockProximityCode,
      );

      await loadQuestion();
    } catch (e) {
      print('StartGame error: $e');
      setState(() {
        loading = false;
        message = e.toString();
      });
    }
  }

  Future<void> loadQuestion() async {
    try {
      final data = await _gameService.getNextQuestion(sessionId!);

      setState(() {
        questionId = data['questionId'];
        questionText = data['text'];
        hints = List<String>.from(data['hints']);
        loading = false;
        message = '';
      });
    } catch (e) {
      setState(() {
        loading = false;
        message = e.toString();
      });
    }
  }

  Future<void> submit() async {
    setState(() => loading = true);

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
      });

      if (!result['gameFinished']) {
        await loadQuestion();
      } else {
        setState(() {
          loading = false;
          message += '\nGame finished!';
        });
      }
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
      appBar: AppBar(title: const Text('Game MVP')),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16),
              child: sessionId == null
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
                        if (questionText != null) ...[
                          Text(
                            questionText!,
                            style: const TextStyle(fontSize: 18),
                          ),
                          const SizedBox(height: 8),
                          ...hints.map((h) => Text('• $h')),
                          TextField(
                            controller: _answerController,
                            decoration: const InputDecoration(
                              labelText: 'Your answer',
                            ),
                          ),
                          const SizedBox(height: 8),
                          ElevatedButton(
                            onPressed: submit,
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
