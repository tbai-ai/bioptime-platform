# Generates the throwaway Xcode project for the iOS simulator smoke test (an app target the UI-test bundle needs as
# its host, plus the DriverUITests bundle that drives the installed Bioptime app). Run by simulator_smoke.sh.
#   ruby gen_driver.rb <work dir for Driver.xcodeproj> <dir holding DriverApp/ and DriverUITests/>
# Needs the xcodeproj gem, which CocoaPods brings in.
require 'xcodeproj'
require 'fileutils'
work = File.expand_path(ARGV[0] || abort('work dir?'))
src  = File.expand_path(ARGV[1] || File.dirname(__FILE__))
FileUtils.mkdir_p(work)
path = File.join(work, 'Driver.xcodeproj')
FileUtils.rm_rf(path)
proj = Xcodeproj::Project.new(path)
app = proj.new_target(:application, 'DriverApp', :ios, '17.0')
ui  = proj.new_target(:ui_test_bundle, 'DriverUITests', :ios, '17.0')
ui.add_dependency(app)
app_group = proj.new_group('DriverApp', File.join(src, 'DriverApp'))
ui_group  = proj.new_group('DriverUITests', File.join(src, 'DriverUITests'))
app.add_file_references([app_group.new_file(File.join(src, 'DriverApp', 'App.swift'))])
ui.add_file_references([ui_group.new_file(File.join(src, 'DriverUITests', 'DriverUITests.swift'))])
common = { 'SWIFT_VERSION' => '5.0', 'GENERATE_INFOPLIST_FILE' => 'YES', 'TARGETED_DEVICE_FAMILY' => '1',
           'CODE_SIGN_STYLE' => 'Automatic', 'CURRENT_PROJECT_VERSION' => '1', 'MARKETING_VERSION' => '1.0' }
app.build_configurations.each do |c|
  c.build_settings.merge!(common).merge!('PRODUCT_BUNDLE_IDENTIFIER' => 'com.bioptime.simdriver',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES', 'INFOPLIST_KEY_UIApplicationSceneManifest_Generation' => 'YES',
    'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks')
end
ui.build_configurations.each do |c|
  c.build_settings.merge!(common).merge!('PRODUCT_BUNDLE_IDENTIFIER' => 'com.bioptime.simdriver.uitests',
    'TEST_TARGET_NAME' => 'DriverApp', 'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @loader_path/Frameworks')
end
proj.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, ui, launch_target: true)
scheme.save_as(path, 'Driver', true)
puts "generated #{path}"
