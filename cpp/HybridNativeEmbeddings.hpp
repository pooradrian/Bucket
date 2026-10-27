#pragma once

#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "HybridNativeEmbeddingsSpec.hpp"

namespace margelo::nitro::crypto {

struct EmbeddingState;

class HybridNativeEmbeddings final : public HybridNativeEmbeddingsSpec {
public:
  HybridNativeEmbeddings();
  ~HybridNativeEmbeddings() override;

  std::string getAbi() override;
  bool getRuntimeLoaded() override;
  std::shared_ptr<Promise<std::string>> loadRuntime(const std::string& libDir) override;
  std::shared_ptr<Promise<EmbeddingModelInfo>> loadModel(const std::string& path, double threads, double contextSize) override;
  std::shared_ptr<Promise<std::vector<std::vector<double>>>> embed(const std::vector<std::string>& texts) override;
  std::shared_ptr<Promise<void>> releaseModel() override;

private:
  void releaseLocked();

  std::mutex mutex_;
  std::unique_ptr<EmbeddingState> state_;
};

}
