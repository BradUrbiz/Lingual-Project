import base64
import os
import unittest

from backend.services.canvas.encryption import decrypt_pat, encrypt_pat, mask_pat


class EncryptDecryptRoundTripTest(unittest.TestCase):
    def setUp(self):
        # Generate a fresh 32-byte key for each test.
        self.key = base64.b64encode(os.urandom(32)).decode()
        os.environ['CANVAS_PAT_ENCRYPTION_KEY'] = self.key

    def tearDown(self):
        os.environ.pop('CANVAS_PAT_ENCRYPTION_KEY', None)

    def test_round_trip(self):
        raw = 'canvas_pat_1234567890abcdef'
        ciphertext = encrypt_pat(raw)
        self.assertNotEqual(ciphertext, raw)
        self.assertEqual(decrypt_pat(ciphertext), raw)

    def test_different_ciphertexts_for_same_input(self):
        raw = 'same_pat_value'
        c1 = encrypt_pat(raw)
        c2 = encrypt_pat(raw)
        self.assertNotEqual(c1, c2, 'Each encryption should use a random nonce')

    def test_empty_pat_round_trip(self):
        ciphertext = encrypt_pat('')
        self.assertEqual(decrypt_pat(ciphertext), '')

    def test_unicode_pat_round_trip(self):
        raw = 'pat_with_유니코드'
        ciphertext = encrypt_pat(raw)
        self.assertEqual(decrypt_pat(ciphertext), raw)

    def test_tampered_ciphertext_raises(self):
        raw = 'good_pat'
        ciphertext = encrypt_pat(raw)
        # Flip a character in the middle of the base64 payload.
        corrupted = ciphertext[:10] + ('A' if ciphertext[10] != 'A' else 'B') + ciphertext[11:]
        with self.assertRaises(Exception):
            decrypt_pat(corrupted)


class MissingKeyTest(unittest.TestCase):
    def setUp(self):
        os.environ.pop('CANVAS_PAT_ENCRYPTION_KEY', None)

    def test_encrypt_without_key_raises(self):
        with self.assertRaises(ValueError):
            encrypt_pat('some_pat')

    def test_decrypt_without_key_raises(self):
        with self.assertRaises(ValueError):
            decrypt_pat('some_ciphertext')


class MaskPatTest(unittest.TestCase):
    def test_mask_long_pat(self):
        masked = mask_pat('canvas_pat_1234567890abcdef')
        self.assertTrue(masked.startswith('canvas'))
        self.assertTrue(masked.endswith('cdef'))
        self.assertIn('*', masked)
        self.assertNotIn('1234567890ab', masked)

    def test_mask_short_pat(self):
        masked = mask_pat('ab')
        self.assertIn('*', masked)

    def test_mask_empty(self):
        self.assertEqual(mask_pat(''), '****')


if __name__ == '__main__':
    unittest.main()
