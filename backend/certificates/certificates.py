
import hashlib
import ipaddress
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from config import CERT_DIR
from certificates.ca import CA_CERT_PATH, CA_KEY_PATH


class CertificateError(Exception):
    """Raised when a host certificate cannot be created or validated."""


def normalize_host(host: str) -> tuple[str, bool]:
    """Normalize a DNS name or IP address."""

    host = host.strip().rstrip(".")

    if not host or any(c in host for c in "/\\@?#"):
        raise ValueError("Invalid certificate hostname")

    try:
        address = ipaddress.ip_address(host.strip("[]"))
        return address.compressed, True
    except ValueError:
        pass

    try:
        normalized = host.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("Invalid internationalized hostname") from exc

    if len(normalized) > 253:
        raise ValueError("Hostname is too long")

    labels = normalized.split(".")
    if any(
        not label
        or len(label) > 63
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", label)
        for label in labels
    ):
        raise ValueError("Invalid DNS hostname")

    return normalized, False


def _paths_for_host(host: str) -> tuple[Path, Path]:
    digest = hashlib.sha256(host.encode("utf-8")).hexdigest()
    return (
        CERT_DIR / f"host-{digest}.crt",
        CERT_DIR / f"host-{digest}.key",
    )


def _load_ca():
    if not CA_CERT_PATH.exists() or not CA_KEY_PATH.exists():
        raise CertificateError(
            "PacketSniff Root CA is missing. Generate it first."
        )

    ca_cert = x509.load_pem_x509_certificate(CA_CERT_PATH.read_bytes())
    ca_key = serialization.load_pem_private_key(
        CA_KEY_PATH.read_bytes(),
        password=None,
    )

    if not isinstance(ca_key, rsa.RSAPrivateKey):
        raise CertificateError("Unsupported Root CA private key type")

    if ca_cert.public_key().public_numbers() != ca_key.public_key().public_numbers():
        raise CertificateError("Root CA certificate and private key do not match")

    return ca_cert, ca_key


def _is_valid_cached_certificate(
    cert_path: Path,
    key_path: Path,
    host: str,
    is_ip: bool,
    ca_cert: x509.Certificate,
) -> bool:
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        key = serialization.load_pem_private_key(
            key_path.read_bytes(),
            password=None,
        )

        if not isinstance(key, rsa.RSAPrivateKey):
            return False

        if cert.public_key().public_numbers() != key.public_key().public_numbers():
            return False

        now = datetime.now(timezone.utc)
        if cert.not_valid_before_utc > now or cert.not_valid_after_utc <= now + timedelta(days=1):
            return False

        if cert.issuer != ca_cert.subject:
            return False

        # Confirm the certificate was signed by our Root CA.
        ca_cert.public_key().verify(
            cert.signature,
            cert.tbs_certificate_bytes,
            padding.PKCS1v15(),
            cert.signature_hash_algorithm,
        )

        san = cert.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value

        if is_ip:
            return host in [str(value) for value in san.get_values_for_type(x509.IPAddress)]

        return host in san.get_values_for_type(x509.DNSName)

    except Exception:
        return False


def get_host_certificate(host: str) -> tuple[Path, Path]:
    """
    Return the certificate and private-key paths for a host.
    Generate or regenerate them when necessary.
    """

    normalized_host, is_ip = normalize_host(host)
    cert_path, key_path = _paths_for_host(normalized_host)

    ca_cert, ca_key = _load_ca()

    if (
        cert_path.exists()
        and key_path.exists()
        and _is_valid_cached_certificate(
            cert_path,
            key_path,
            normalized_host,
            is_ip,
            ca_cert,
        )
    ):
        return cert_path, key_path

    host_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    now = datetime.now(timezone.utc)

    subject = x509.Name([
        x509.NameAttribute(
            NameOID.COMMON_NAME,
            normalized_host,
        )
    ])

    san_value = (
        x509.IPAddress(ipaddress.ip_address(normalized_host))
        if is_ip
        else x509.DNSName(normalized_host)
    )

    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(host_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(
            x509.SubjectAlternativeName([san_value]),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.SERVER_AUTH
            ]),
            critical=False,
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=None,
                decipher_only=None,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_path.write_bytes(
        certificate.public_bytes(serialization.Encoding.PEM)
    )

    key_path.write_bytes(
        host_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

    return cert_path, key_path
