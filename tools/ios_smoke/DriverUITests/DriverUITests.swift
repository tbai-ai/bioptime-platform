import XCTest

/// Drives the Bioptime app already installed on the simulator (com.bioptime.app, or BP_BUNDLE_ID): signs in as the
/// demo member through the real UI and screenshots Home, Plan, Coach, Tests and Me into BP_OUT. Credentials and the
/// output folder arrive as environment variables that simulator_smoke.sh writes into the .xctestrun file, so nothing
/// is hardcoded here. Started by tools/ios_smoke/simulator_smoke.sh.
final class DriverUITests: XCTestCase {
    var app: XCUIApplication!
    var out = "/tmp/bp-sim"
    var notes: [String] = []

    override func setUpWithError() throws {
        continueAfterFailure = true
        app = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["BP_BUNDLE_ID"] ?? "com.bioptime.app")
        out = ProcessInfo.processInfo.environment["BP_OUT"] ?? out
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
    }

    func note(_ s: String) { notes.append(s); NSLog("[driver] %@", s) }

    func shot(_ name: String) {
        let png = XCUIScreen.main.screenshot().pngRepresentation
        let url = URL(fileURLWithPath: out).appendingPathComponent("\(name).png")
        do { try png.write(to: url); note("shot \(name) (\(png.count) bytes)") } catch { note("shot \(name) FAILED: \(error)") }
    }

    func dump(_ name: String) {
        let url = URL(fileURLWithPath: out).appendingPathComponent("\(name).txt")
        try? app.debugDescription.write(to: url, atomically: true, encoding: .utf8)
    }

    /// The bottom tab bar item with this label (React Navigation labels them "Plan" or "Plan, tab, 2 of 5").
    func waitForTab(_ name: String, timeout: TimeInterval) -> XCUIElement? {
        let pred = NSPredicate(format: "label == %@ OR label BEGINSWITH %@", name, "\(name),")
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let h = app.frame.height
            let all = app.descendants(matching: .any).matching(pred).allElementsBoundByIndex
            if let hit = all.first(where: { $0.exists && $0.frame.minY > h * 0.8 && $0.frame.height > 0 }) { return hit }
            sleep(1)
        } while Date() < deadline
        return nil
    }

    func testSignInAndTabs() throws {
        // Failures are collected and recorded once at the end, after the screenshots and notes are on disk: on this
        // simulator XCTest has stalled while handling a failure recorded mid-test, and the evidence matters more.
        var problems: [String] = []
        let env = ProcessInfo.processInfo.environment
        let email = env["BP_EMAIL"] ?? ""
        let password = env["BP_PASSWORD"] ?? ""
        if email.isEmpty || password.isEmpty { finish(["BP_EMAIL or BP_PASSWORD not set"]); return }

        app.launch()
        sleep(6)
        shot("01-launch"); dump("ui-launch")

        let emailField = app.textFields.firstMatch
        if emailField.waitForExistence(timeout: 45) {
            enter(email, into: emailField, named: "email")
            // On this window height the keyboard covers the password field and the Sign in button, so dismiss it
            // with Return before moving on (a person would do the same, or press Return in the password field).
            app.typeText("\n"); sleep(1)
            note("keyboards on screen after return: \(app.keyboards.count)")
            let pwField = app.secureTextFields.firstMatch
            if pwField.waitForExistence(timeout: 10) { enter(password, into: pwField, named: "password") }
            else { problems.append("password field never appeared") }
            shot("02-signing-in")
            let signIn = app.buttons["Sign in"]
            if signIn.exists && signIn.isHittable && app.keyboards.count == 0 { note("tapping Sign in button"); signIn.tap() }
            else { note("submitting with Return in the password field (button is under the keyboard)"); app.typeText("\n") }
        } else if waitForTab("Home", timeout: 5) != nil {
            note("no sign-in form: the app was already signed in from an earlier run; continuing with that session")
        } else {
            dump("ui-no-form"); finish(["neither the sign-in form nor the tab bar appeared"]); return
        }

        guard waitForTab("Home", timeout: 90) != nil else {
            shot("03-after-signin-no-tabs"); dump("ui-after-signin")
            finish(problems + ["tab bar never appeared after sign-in"]); return
        }
        sleep(6) // let Home finish loading from the API
        shot("03-home"); dump("ui-home")
        for name in ["Plan", "Coach", "Tests", "Me"] {
            guard let t = waitForTab(name, timeout: 15) else { problems.append("tab \(name) not found"); continue }
            t.tap(); sleep(5)
            shot("04-tab-\(name)"); dump("ui-\(name.lowercased())")
        }
        finish(problems)
    }

    func finish(_ problems: [String]) {
        if problems.isEmpty { note("done: signed in and captured Home, Plan, Coach, Tests, Me") }
        else { for p in problems { note("problem: \(p)") } }
        writeNotes()
        if !problems.isEmpty { XCTFail(problems.joined(separator: "; ")) }
    }

    func hasFocus(_ e: XCUIElement) -> Bool { (e.value(forKey: "hasKeyboardFocus") as? Bool) ?? false }

    /// Tap a field, wait until it reports keyboard focus (re-tapping once), then type. If focus is never reported
    /// (secure fields on some iOS versions), fall back to pasting through the edit menu.
    func enter(_ text: String, into field: XCUIElement, named name: String) {
        field.tap()
        var focused = false
        for i in 0..<10 {
            usleep(500_000)
            if hasFocus(field) { focused = true; break }
            if i == 4 { note("\(name): no focus after tap, tapping centre again"); field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
        }
        note("\(name): keyboardFocus=\(focused) keyboardsOnScreen=\(app.keyboards.count)")
        if focused || app.keyboards.count > 0 {
            usleep(600_000) // the keyboard drops the first keystrokes if typing starts the instant it appears
            if focused { field.typeText(text) } else { app.typeText(text) }
            // plain fields are checked and retyped: a dropped keystroke would otherwise look like a wrong password
            if field.elementType != .secureTextField {
                for attempt in 1...2 {
                    usleep(500_000)
                    let current = (field.value as? String) ?? ""
                    if current == text || current.isEmpty && text.isEmpty { break }
                    note("\(name): typed '\(current)', expected '\(text)'; retyping (attempt \(attempt))")
                    field.tap(); usleep(500_000)
                    if !current.isEmpty { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2)) }
                    usleep(400_000)
                    field.typeText(text)
                }
            }
        } else {
            note("\(name): pasting instead")
            UIPasteboard.general.string = text
            field.press(forDuration: 1.2)
            let paste = app.menuItems["Paste"]
            if paste.waitForExistence(timeout: 4) { paste.tap() } else { note("\(name): no Paste menu item") }
        }
        usleep(500_000)
        note("\(name): value now '\(String(describing: field.value))'")
    }

    func writeNotes() { try? notes.joined(separator: "\n").write(toFile: "\(out)/driver.log", atomically: true, encoding: .utf8) }
}
