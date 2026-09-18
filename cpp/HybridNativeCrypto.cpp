#include "HybridNativeCrypto.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>

#include "AesGcm.hpp"

namespace margelo::nitro::crypto {
namespace {

constexpr char HEX_DIGITS[] = "0123456789abcdef";

int hexValue(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return c - 'a' + 10;
  }
  if (c >= 'A' && c <= 'F') {
    return c - 'A' + 10;
  }
  return -1;
}

std::vector<uint8_t> hexToBytes(const std::string& hex) {
  if (hex.size() % 2 != 0) {
    throw std::runtime_error("NativeCrypto: invalid hex string (odd length)");
  }
  std::vector<uint8_t> out(hex.size() / 2);
  for (size_t i = 0; i < out.size(); ++i) {
    int hi = hexValue(hex[2 * i]);
    int lo = hexValue(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) {
      throw std::runtime_error("NativeCrypto: invalid hex string");
    }
    out[i] = uint8_t((hi << 4) | lo);
  }
  return out;
}

std::string bytesToHex(const uint8_t* data, size_t len) {
  std::string out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; ++i) {
    out.push_back(HEX_DIGITS[data[i] >> 4]);
    out.push_back(HEX_DIGITS[data[i] & 0x0f]);
  }
  return out;
}

std::array<uint8_t, aesgcm::AES256_KEY_LEN> parseKey(const std::string& keyHex) {
  std::vector<uint8_t> key = hexToBytes(keyHex);
  if (key.size() != aesgcm::AES256_KEY_LEN) {
    throw std::runtime_error("NativeCrypto: key must be 32 bytes (64 hex chars)");
  }
  std::array<uint8_t, aesgcm::AES256_KEY_LEN> out{};
  std::copy(key.begin(), key.end(), out.begin());
  return out;
}

void randomBytes(uint8_t* out, size_t len) {
  FILE* f = std::fopen("/dev/urandom", "rb");
  if (f == nullptr) {
    throw std::runtime_error("NativeCrypto: cannot open /dev/urandom");
  }
  size_t read = std::fread(out, 1, len, f);
  std::fclose(f);
  if (read != len) {
    throw std::runtime_error("NativeCrypto: short read from /dev/urandom");
  }
}

}

std::string HybridNativeCrypto::encrypt(const std::string& plaintext, const std::string& keyHex) {
  std::array<uint8_t, aesgcm::AES256_KEY_LEN> key = parseKey(keyHex);

  uint8_t nonce[aesgcm::GCM_NONCE_LEN];
  randomBytes(nonce, sizeof(nonce));

  uint8_t tag[aesgcm::GCM_TAG_LEN];
  std::vector<uint8_t> ciphertext = aesgcm::aes256GcmEncrypt(
      key.data(), nonce, reinterpret_cast<const uint8_t*>(plaintext.data()), plaintext.size(), tag);

  return bytesToHex(nonce, sizeof(nonce)) + bytesToHex(ciphertext.data(), ciphertext.size()) +
         bytesToHex(tag, sizeof(tag));
}

std::string HybridNativeCrypto::decrypt(const std::string& ciphertextHex,
                                        const std::string& keyHex) {
  std::array<uint8_t, aesgcm::AES256_KEY_LEN> key = parseKey(keyHex);
  std::vector<uint8_t> bytes = hexToBytes(ciphertextHex);

  constexpr size_t overhead = aesgcm::GCM_NONCE_LEN + aesgcm::GCM_TAG_LEN;
  if (bytes.size() < overhead) {
    throw std::runtime_error("NativeCrypto: ciphertext too short");
  }
  const uint8_t* nonce = bytes.data();
  const uint8_t* tag = bytes.data() + bytes.size() - aesgcm::GCM_TAG_LEN;
  const uint8_t* ciphertext = bytes.data() + aesgcm::GCM_NONCE_LEN;
  size_t ciphertextLen = bytes.size() - overhead;

  std::vector<uint8_t> plaintext;
  if (!aesgcm::aes256GcmDecrypt(key.data(), nonce, ciphertext, ciphertextLen, tag, plaintext)) {
    throw std::runtime_error("NativeCrypto: decryption failed (authentication tag mismatch)");
  }
  return std::string(reinterpret_cast<const char*>(plaintext.data()), plaintext.size());
}

}
