require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CaptionBurner'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'Burns animated captions into video with AVFoundation.'
  s.description    = 'Extracts 16 kHz audio for transcription and renders caption layers into the video.'
  s.author         = 'AltixCode'
  s.homepage       = 'https://www.altixcode.com'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
