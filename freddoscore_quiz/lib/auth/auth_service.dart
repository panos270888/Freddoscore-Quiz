import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  /// Stream to listen to auth state changes
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Currently signed-in user
  User? get currentUser => _auth.currentUser;

  /// Register with email & password
  Future<UserCredential> register({
    required String email,
    required String password,
    required String username,
  }) async {
    final credential = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );

    final user = credential.user;
    if (user == null) {
      throw FirebaseAuthException(
        code: 'user-null',
        message: 'User creation failed',
      );
    }

    // Create Firestore user document
    await _firestore.collection('users').doc(user.uid).set({
      'uid': user.uid,
      'email': user.email,
      'username': username,
      'createdAt': FieldValue.serverTimestamp(),
    });

    return credential;
  }

  /// Login with email & password
  Future<UserCredential> login({
    required String email,
    required String password,
  }) async {
    return await _auth.signInWithEmailAndPassword(
      email: email,
      password: password,
    );
  }

  /// Logout
  Future<void> logout() async {
    await _auth.signOut();
  }
}
