import 'package:flutter/material.dart';
import '../auth/auth_service.dart';

class HomePage extends StatelessWidget {
  HomePage({super.key});

  final AuthService _authService = AuthService();

  @override
  Widget build(BuildContext context) {
    final user = _authService.currentUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await _authService.logout();
            },
          ),
        ],
      ),
      body: Center(
        child: Text(
          'Welcome ${user?.email ?? ''}',
          style: const TextStyle(fontSize: 18),
        ),
      ),
    );
  }
}
