#pragma once

#include <string>

#include "HybridNativeCryptoSpec.hpp"

namespace margelo::nitro::crypto {

class HybridNativeCrypto : public HybridNativeCryptoSpec {
public:
  HybridNativeCrypto() : HybridObject(TAG) {}

  std::string encrypt(const std::string& plaintext, const std::string& keyHex) override;
  std::string decrypt(const std::string& ciphertextHex, const std::string& keyHex) override;
};

}
