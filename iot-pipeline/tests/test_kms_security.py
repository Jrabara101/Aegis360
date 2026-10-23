"""
Unit tests for KMS Security and envelope encryption module
"""

import sys
import os
import pytest

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "database", "encryption")))
from kms_security import KMSSecurityService


def test_encryption_and_decryption_roundtrip():
    kms_service = KMSSecurityService()

    secret_passphrase = "BlueberryPancake"
    encrypted = kms_service.encrypt_field(secret_passphrase)

    assert encrypted != secret_passphrase
    assert len(encrypted) > 10

    decrypted = kms_service.decrypt_field(encrypted)
    assert decrypted == secret_passphrase


def test_phone_number_encryption():
    kms_service = KMSSecurityService()

    phone = "+1-512-555-0199"
    context = {"senior_id": "snr_8832_v", "field": "phone"}

    encrypted = kms_service.encrypt_field(phone, context=context)
    assert phone not in encrypted

    decrypted = kms_service.decrypt_field(encrypted, context=context)
    assert decrypted == phone


def test_empty_string_handling():
    kms_service = KMSSecurityService()
    assert kms_service.encrypt_field("") == ""
    assert kms_service.decrypt_field("") == ""
