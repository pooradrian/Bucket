require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroCrypto"
  s.version      = package["version"]
  s.summary      = "AES-256-GCM crypto for Bucket (Nitro)"
  s.homepage     = "https://github.com/anomalyco/opencode"
  s.license      = { :type => "PolyForm-Noncommercial-1.0.0", :file => "LICENSE" }
  s.authors      = "Bucket"

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/anomalyco/opencode", :tag => "#{s.version}" }

  s.source_files = [
    "cpp/**/*.{hpp,cpp}",
  ]

  load 'nitrogen/generated/ios/NitroCrypto+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
