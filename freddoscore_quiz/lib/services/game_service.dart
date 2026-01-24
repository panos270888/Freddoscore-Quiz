import 'package:cloud_functions/cloud_functions.dart';

class GameService {
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  Future<String> startGame() async {
    final result = await _functions.httpsCallable('startGameSession').call();

    return result.data['sessionId'];
  }

  Future<Map<String, dynamic>> getNextQuestion(String sessionId) async {
    final result = await _functions.httpsCallable('getNextQuestion').call({
      'sessionId': sessionId,
    });

    return Map<String, dynamic>.from(result.data);
  }

  Future<Map<String, dynamic>> submitAnswer({
    required String sessionId,
    required String questionId,
    required String answerText,
  }) async {
    final result = await _functions.httpsCallable('submitAnswer').call({
      'sessionId': sessionId,
      'questionId': questionId,
      'answerText': answerText,
    });

    return Map<String, dynamic>.from(result.data);
  }
}
