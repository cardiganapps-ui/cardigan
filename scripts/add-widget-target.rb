#!/usr/bin/env ruby
# frozen_string_literal: true

# ── CardiganWidgets extension target ─────────────────────────────────
# Creates the WidgetKit app-extension target inside the FRESHLY
# GENERATED ios/App/App.xcodeproj (the ios/ dir is never committed —
# CI runs `npx cap add ios` and re-applies every native customization
# on each build). Invoked as the LAST step of apply-ios-config.sh,
# after that script's python regex patches, because the xcodeproj gem
# re-serializes the whole pbxproj on save; a post-save assertion below
# verifies the python-applied App-target signing survived.
#
# Responsibilities:
#   1. New PBXNativeTarget `CardiganWidgets` (app-extension, iOS 17.0 —
#      required for AppIntentConfiguration; devices below 17 simply
#      don't see the widgets, which Apple allows for extensions).
#   2. Sources phase = every .swift in ios/App/CardiganWidgets/
#      (copied there from ios-config/widgets/ by apply-ios-config.sh);
#      resources phase = PrivacyInfo.xcprivacy.
#   3. Build settings: bundle id mx.cardigan.app.widgets, its own
#      Info.plist/entitlements, MARKETING_VERSION matching the app
#      target (App Store validation requires the extension's
#      CFBundleShortVersionString to equal the app's), and — in
#      Release, unless WIDGET_SIGNING=none — manual signing with the
#      "Cardigan Widgets App Store" provisioning profile.
#      CURRENT_PROJECT_VERSION defaults to 1 and is overridden for ALL
#      targets by the CI xcodebuild CLI argument.
#   4. App target: dependency on the extension + an "Embed App
#      Extensions" copy-files phase (PlugIns dst) so the .appex ships
#      inside the app, and CardiganBridgeViewController.swift added to
#      its sources (mirrors widget data into the App Group).
#
# Env: APPLE_TEAM_ID (required unless WIDGET_SIGNING=none),
#      MARKETING_VERSION (default matches apply-ios-config.sh),
#      WIDGET_SIGNING=manual|none (default manual).
#
# Idempotent: exits 0 immediately if the target already exists.

require "xcodeproj"

PROJECT_PATH = "ios/App/App.xcodeproj"
WIDGET_TARGET_NAME = "CardiganWidgets"
WIDGET_BUNDLE_ID = "mx.cardigan.app.widgets"
WIDGET_PROFILE = "Cardigan Widgets App Store"
WIDGET_DIR = "ios/App/CardiganWidgets"
# App-target Swift files (beyond Capacitor's own) that must be compiled in:
# the bridge VC that mirrors widget data into the App Group.
# apply-ios-config.sh copies it into ios/App/App/ before this runs.
APP_TARGET_SWIFT = [
  "CardiganBridgeViewController.swift",
].freeze
DEPLOYMENT_TARGET = "17.0"

marketing_version = ENV["MARKETING_VERSION"] || "20.6"
signing = ENV["WIDGET_SIGNING"] || "manual"

abort "add-widget-target: #{PROJECT_PATH} not found — run 'npx cap add ios' first" unless File.directory?(PROJECT_PATH)

project = Xcodeproj::Project.open(PROJECT_PATH)

# Idempotency first — a re-run against an already-patched project is a
# no-op regardless of env (local re-runs won't have APPLE_TEAM_ID set).
if project.targets.any? { |t| t.name == WIDGET_TARGET_NAME }
  puts "✓ #{WIDGET_TARGET_NAME} target already present — nothing to do"
  exit 0
end

abort "add-widget-target: #{WIDGET_DIR} not found — apply-ios-config.sh must copy ios-config/widgets/ first" unless File.directory?(WIDGET_DIR)
if signing == "manual" && (ENV["APPLE_TEAM_ID"] || "").empty?
  abort "add-widget-target: APPLE_TEAM_ID is required (or set WIDGET_SIGNING=none for unsigned dry-runs)"
end

app_target = project.targets.find { |t| t.name == "App" }
abort "add-widget-target: App target not found in #{PROJECT_PATH}" unless app_target

# ── 1. Target ──
# new_target wires up product ref, default build phases, and Debug/
# Release configurations inheriting the project-level ones.
widget_target = project.new_target(:app_extension, WIDGET_TARGET_NAME, :ios, DEPLOYMENT_TARGET)

# ── 2. Files ──
group = project.main_group.new_group(WIDGET_TARGET_NAME, WIDGET_TARGET_NAME)
swift_files = Dir.glob(File.join(WIDGET_DIR, "*.swift")).sort
abort "add-widget-target: no .swift sources found in #{WIDGET_DIR}" if swift_files.empty?
swift_files.each do |path|
  ref = group.new_file(File.basename(path))
  widget_target.source_build_phase.add_file_reference(ref)
end
privacy_ref = group.new_file("PrivacyInfo.xcprivacy")
widget_target.resources_build_phase.add_file_reference(privacy_ref)
# Info.plist + entitlements are referenced via build settings only —
# adding Info.plist to the resources phase would trigger a duplicate-
# Info.plist build error.

# Bundled Nunito / Nunito Sans faces (fonts/, registered via Info.plist
# UIAppFonts) → the extension's resources phase so they ship in the .appex.
font_files = Dir.glob(File.join(WIDGET_DIR, "fonts", "*.ttf")).sort
abort "add-widget-target: no fonts found in #{WIDGET_DIR}/fonts — apply-ios-config.sh must copy them first" if font_files.empty?
font_files.each do |path|
  ref = group.new_file("fonts/#{File.basename(path)}")
  widget_target.resources_build_phase.add_file_reference(ref)
end

# ── 3. Build settings ──
widget_target.build_configurations.each do |config|
  bs = config.build_settings
  bs["PRODUCT_BUNDLE_IDENTIFIER"] = WIDGET_BUNDLE_ID
  bs["PRODUCT_NAME"] = "$(TARGET_NAME)"
  bs["INFOPLIST_FILE"] = "#{WIDGET_TARGET_NAME}/Info.plist"
  bs["GENERATE_INFOPLIST_FILE"] = "NO"
  bs["CODE_SIGN_ENTITLEMENTS"] = "#{WIDGET_TARGET_NAME}/#{WIDGET_TARGET_NAME}.entitlements"
  bs["SWIFT_VERSION"] = "5.0"
  bs["IPHONEOS_DEPLOYMENT_TARGET"] = DEPLOYMENT_TARGET
  bs["TARGETED_DEVICE_FAMILY"] = "1,2"
  bs["SKIP_INSTALL"] = "YES"
  bs["MARKETING_VERSION"] = marketing_version
  bs["CURRENT_PROJECT_VERSION"] = "1"
  bs["SWIFT_EMIT_LOC_STRINGS"] = "YES"
  if config.name == "Release" && signing == "manual"
    bs["CODE_SIGN_STYLE"] = "Manual"
    bs["CODE_SIGN_IDENTITY"] = "Apple Distribution"
    bs["DEVELOPMENT_TEAM"] = ENV["APPLE_TEAM_ID"]
    bs["PROVISIONING_PROFILE_SPECIFIER"] = WIDGET_PROFILE
  end
end

# ── 4. Embed in the App target + app-side plugin source ──
app_target.add_dependency(widget_target)

embed_phase = app_target.copy_files_build_phases.find { |p| p.name == "Embed App Extensions" }
embed_phase ||= app_target.new_copy_files_build_phase("Embed App Extensions")
embed_phase.symbol_dst_subfolder_spec = :plug_ins
embed_phase.dst_path = ""
build_file = embed_phase.add_file_reference(widget_target.product_reference)
build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

app_group = project.main_group.find_subpath("App", false)
abort "add-widget-target: App group not found" unless app_group
APP_TARGET_SWIFT.each do |name|
  abort "add-widget-target: ios/App/App/#{name} not found — apply-ios-config.sh must copy it first" unless File.file?("ios/App/App/#{name}")
  ref = app_group.new_file(name)
  app_target.source_build_phase.add_file_reference(ref)
end

project.save

# ── 5. Post-save assertions ──
# The xcodeproj gem rewrites the entire pbxproj; make sure the python
# regex patch from apply-ios-config.sh (App-target manual signing) and
# our own additions survived re-serialization. Failing loudly here is
# far cheaper than a mis-signed archive 25 minutes into a CI build.
pbxproj = File.read(File.join(PROJECT_PATH, "project.pbxproj"))
{
  'App-target provisioning profile' => 'PROVISIONING_PROFILE_SPECIFIER = "Cardigan App Store"',
  "widget bundle id" => "PRODUCT_BUNDLE_IDENTIFIER = #{WIDGET_BUNDLE_ID}",
  "embed phase" => "Embed App Extensions",
}.each do |label, needle|
  unless pbxproj.include?(needle)
    abort "add-widget-target: post-save check failed — #{label} (#{needle.inspect}) missing from pbxproj"
  end
end
if signing == "manual" && !pbxproj.include?(%(PROVISIONING_PROFILE_SPECIFIER = "#{WIDGET_PROFILE}"))
  abort "add-widget-target: post-save check failed — widget provisioning profile missing"
end

puts "✓ #{WIDGET_TARGET_NAME} target created (#{swift_files.length} sources, iOS #{DEPLOYMENT_TARGET}, signing=#{signing})"
