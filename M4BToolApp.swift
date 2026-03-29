#!/usr/bin/env swift

import Cocoa
import WebKit
import PDFKit
import AVFoundation
import ScreenCaptureKit
import CoreMedia
import Carbon
import Quartz
import EventKit
import MultipeerConnectivity

// --- 1. 标准录音引擎 (仅麦克风 - 使用 AVAudioRecorder) ---
class SimpleAudioRecorder: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    var onFinish: ((String) -> Void)?
    var onError: ((String) -> Void)?
    
    func start(outputPath: String) {
        let url = URL(fileURLWithPath: outputPath)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        do {
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.delegate = self
            recorder?.record()
            print("标准录音启动: \(outputPath)")
        } catch {
            onError?("AVAudioRecorder Error: \(error.localizedDescription)")
        }
    }
    
    func stop() {
        recorder?.stop()
    }
    
    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        if flag {
            onFinish?(recorder.url.path)
        } else {
            onError?("Recording failed to save correctly.")
        }
    }
}

// --- 2. 会议录音引擎 (系统+麦克风 - 使用 ScreenCaptureKit) ---
@available(macOS 12.3, *)
class AudioCaptureManager: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var assetWriter: AVAssetWriter?
    private var audioInput: AVAssetWriterInput?
    private var isWriting = false
    private var firstSampleTime: CMTime?
    
    var onFinish: ((String) -> Void)?
    var onError: ((String) -> Void)?
    
    func startCapture(outputPath: String) {
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { [weak self] content, error in
            guard let self = self else { return }
            if let error = error {
                self.onError?("Failed to get shareable content: \(error.localizedDescription)")
                return
            }
            
            guard let content = content else { return }
            let config = SCStreamConfiguration()
            config.capturesAudio = true
            config.excludesCurrentProcessAudio = false 
            
            if #available(macOS 15.0, *) {
                config.captureMicrophone = true
            }

            let filter = SCContentFilter(display: content.displays[0], excludingWindows: [])
            
            do {
                self.assetWriter = try AVAssetWriter(outputURL: URL(fileURLWithPath: outputPath), fileType: .m4a)
                let settings: [String: Any] = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 44100,
                    AVNumberOfChannelsKey: 2,
                    AVEncoderBitRateKey: 128000
                ]
                self.audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
                self.audioInput?.expectsMediaDataInRealTime = true
                if let input = self.audioInput, self.assetWriter?.canAdd(input) == true {
                    self.assetWriter?.add(input)
                }
                self.assetWriter?.startWriting()
                self.isWriting = true
                
                self.stream = SCStream(filter: filter, configuration: config, delegate: self)
                try self.stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audio-capture-queue"))
                self.stream?.startCapture { error in
                    if let error = error { self.onError?("Capture start error: \(error.localizedDescription)") }
                }
            } catch {
                self.onError?("Setup error: \(error.localizedDescription)")
            }
        }
    }
    
    func stopCapture() {
        stream?.stopCapture { [weak self] _ in
            guard let self = self else { return }
            self.isWriting = false
            self.audioInput?.markAsFinished()
            self.assetWriter?.finishWriting {
                if let url = self.assetWriter?.outputURL {
                    self.onFinish?(url.path)
                }
            }
        }
    }
    
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, isWriting, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        if firstSampleTime == nil {
            firstSampleTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
            assetWriter?.startSession(atSourceTime: firstSampleTime!)
        }
        if let input = audioInput, input.isReadyForMoreMediaData {
            input.append(sampleBuffer)
        }
    }
}

// --- 3. 手机端无线传输管理 (Multipeer Connectivity) ---
class WirelessTransferManager: NSObject, MCSessionDelegate, MCNearbyServiceBrowserDelegate {
    private let serviceType = "audioagent-xfer"
    private let myPeerId = MCPeerID(displayName: Host.current().localizedName ?? "Mac Studio")
    private var session: MCSession?
    private var browser: MCNearbyServiceBrowser?
    
    var onFileReceived: ((String) -> Void)?
    
    override init() {
        super.init()
        session = MCSession(peer: myPeerId, securityIdentity: nil, encryptionPreference: .required)
        session?.delegate = self
        
        browser = MCNearbyServiceBrowser(peer: myPeerId, serviceType: serviceType)
        browser?.delegate = self
    }
    
    func start() {
        browser?.startBrowsingForPeers()
        print("无线传输服务已启动，正在搜索 iPhone...")
    }
    
    func stop() {
        browser?.stopBrowsingForPeers()
        session?.disconnect()
    }
    
    // MARK: - MCNearbyServiceBrowserDelegate
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        print("发现设备: \(peerID.displayName), 正在邀请...")
        browser.invitePeer(peerID, to: session!, withContext: nil, timeout: 30)
    }
    
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        print("失去设备连接: \(peerID.displayName)")
    }
    
    // MARK: - MCSessionDelegate
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        switch state {
        case .connected: print("已连接到 iPhone: \(peerID.displayName)")
        case .connecting: print("正在连接 iPhone...")
        case .notConnected: print("与 iPhone 断开连接")
        @unknown default: break
        }
    }
    
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {
        print("正在接收来自 \(peerID.displayName) 的文件: \(resourceName)...")
    }
    
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        if let error = error {
            print("接收文件失败: \(error.localizedDescription)")
            return
        }
        
        guard let tempURL = localURL else { return }
        
        // 确保文件名有后缀
        var finalName = resourceName
        if !finalName.contains(".") {
            finalName += ".m4a"
        }
        
        onFileReceived?(tempURL.path)
    }
}


class AppDelegate: NSResponder, NSApplicationDelegate, NSWindowDelegate, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process!
    var port: Int = 8080
    
    // Status Bar & Recording State
    var statusItem: NSStatusItem!
    var wirelessManager: WirelessTransferManager?
    var isRecording = false
    var recordingMode: String? // "standard" or "meeting"
    
    // Recorders
    var standardRecorder = SimpleAudioRecorder()
    var meetingRecorder: Any? // AudioCaptureManager
    
    var blinkTimer: Timer?
    let appVersion = "2.2.0"
    var previewURL: URL?
    
    let userDataDir: String = {
        let paths = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        let dir = paths[0].appendingPathComponent("AudioAgent/UserData").path
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
        return dir
    }()

    let recordDir: String = {
        let paths = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
        let dir = paths[0].appendingPathComponent("recordfile").path
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
        return dir
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("AudioAgent v\(appVersion) 启动中...")
        self.applyPendingUpdate()
        setupStatusBar()
        setupGlobalHotkeys()
        
        // Setup Wireless Transfer
        wirelessManager = WirelessTransferManager()
        wirelessManager?.onFileReceived = { [weak self] tempPath in
            guard let self = self else { return }
            let fileName = "iPhone_\(Int(Date().timeIntervalSince1970)).m4a"
            let destinationPath = (self.recordDir as NSString).appendingPathComponent(fileName)
            
            do {
                if FileManager.default.fileExists(atPath: destinationPath) {
                    try? FileManager.default.removeItem(atPath: destinationPath)
                }
                try FileManager.default.moveItem(atPath: tempPath, toPath: destinationPath)
                print("手机录音已同步: \(destinationPath)")
                
                // Refresh WebView
                DispatchQueue.main.async {
                    self.webView.evaluateJavaScript("if(window.loadAllFiles) window.loadAllFiles(true);", completionHandler: nil)
                }
            } catch {
                print("搬移同步文件失败: \(error.localizedDescription)")
            }
        }
        wirelessManager?.start()
        
        // Window Setup
        let rect = NSRect(x: 0, y: 0, width: 1200, height: 800)
        window = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.delegate = self; window.center(); window.title = "AudioAgent"
        window.setFrameAutosaveName("MainWindow"); window.isReleasedWhenClosed = false 

        let webConfiguration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(self, name: "filePicker")
        contentController.add(self, name: "directoryPicker")
        contentController.add(self, name: "linkFilePicker")
        contentController.add(self, name: "locateGoogleDrive")
        contentController.add(self, name: "openDirectory")
        contentController.add(self, name: "previewFile")
        contentController.add(self, name: "shareToIMA")
        contentController.add(self, name: "shareToChatGPT")
        contentController.add(self, name: "startRecording")
        contentController.add(self, name: "stopRecording")
        contentController.add(self, name: "importFiles")
        contentController.add(self, name: "createCalendarEvent")
        
        let mac = self.getMacAddress()
        let varsScript = "window.macAddress='\(mac)'; window.userDataPath='\(self.userDataDir.replacingOccurrences(of:"'",with:"\\'"))'; window.recordPath='\(self.recordDir.replacingOccurrences(of:"'",with:"\\'"))'; window.appVersion='\(self.appVersion)';"
        contentController.addUserScript(WKUserScript(source: varsScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webConfiguration.userContentController = contentController

        webView = WKWebView(frame: window.contentView!.bounds, configuration: webConfiguration)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 AudioAgent/\(appVersion)"
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self; webView.uiDelegate = self
        window.contentView?.addSubview(webView)
        
        // Add Cmd+R local listener for refresh
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { (event) -> NSEvent? in
            if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "r" {
                self.webView.reload()
                return nil
            }
            return event
        }
        
        setupMenuBar()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        DispatchQueue.global(qos: .userInitiated).async { self.prepareEnvironment() }
        
        // Setup Standard Recorder
        standardRecorder.onFinish = { [weak self] path in self?.handleRecordingFinished(path: path) }
        standardRecorder.onError = { [weak self] error in DispatchQueue.main.async { self?.showAlert(message: error) } }
        
        // Setup Meeting Recorder (Lazy initialisation inside action if needed, but we can set callback here)
        if #available(macOS 12.3, *) {
            let manager = AudioCaptureManager()
            manager.onFinish = { [weak self] path in self?.handleRecordingFinished(path: path) }
            manager.onError = { [weak self] error in DispatchQueue.main.async { self?.showAlert(message: error) } }
            self.meetingRecorder = manager
        }
    }

    func handleRecordingFinished(path: String) {
        DispatchQueue.main.async {
            self.isRecording = false
            self.recordingMode = nil
            self.stopBlinking()
            self.webView.evaluateJavaScript("if(window.onRecordingStatus) window.onRecordingStatus(false, '\(path.replacingOccurrences(of: "'", with: "\\'"))');", completionHandler: nil)
            self.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.title = "🎙️"
            button.action = #selector(statusBarClicked)
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open AudioAgent", action: #selector(showMainWindow), keyEquivalent: "a"))
        menu.addItem(NSMenuItem.separator())
        
        // Standard Recording (^R)
        let startStandard = NSMenuItem(title: "Start Recording (^R)", action: #selector(startStandardRecording), keyEquivalent: "r")
        startStandard.keyEquivalentModifierMask = .control
        menu.addItem(startStandard)
        
        // Meeting Recording (Disabled)
        let startMeeting = NSMenuItem(title: "Record Online Meeting (System Audio) - Disabled", action: #selector(startMeetingRecording), keyEquivalent: "")
        startMeeting.isEnabled = false
        menu.addItem(startMeeting)
        
        let stopItem = NSMenuItem(title: "Stop Recording (^S)", action: #selector(stopRecordingAction), keyEquivalent: "s")
        stopItem.keyEquivalentModifierMask = .control
        menu.addItem(stopItem)
        
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    @objc func statusBarClicked() { showMainWindow() }
    @objc func showMainWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func startStandardRecording() {
        if isRecording { return }
        let filename = "Simple_Record_\(Int(Date().timeIntervalSince1970)).m4a"
        let path = URL(fileURLWithPath: recordDir).appendingPathComponent(filename).path
        isRecording = true
        recordingMode = "standard"
        startBlinking()
        standardRecorder.start(outputPath: path)
        webView.evaluateJavaScript("if(window.onRecordingStatus) window.onRecordingStatus(true);", completionHandler: nil)
    }

    @objc func startMeetingRecording() {
        if isRecording { return }
        let filename = "Meeting_Record_\(Int(Date().timeIntervalSince1970)).m4a"
        let path = URL(fileURLWithPath: recordDir).appendingPathComponent(filename).path
        
        if #available(macOS 12.3, *), let manager = meetingRecorder as? AudioCaptureManager {
            print("Starting Meeting Recording Engine...")
            isRecording = true
            recordingMode = "meeting"
            startBlinking()
            manager.startCapture(outputPath: path)
            webView.evaluateJavaScript("if(window.onRecordingStatus) window.onRecordingStatus(true);", completionHandler: nil)
        } else {
            showAlert(message: "Meeting recording requires macOS 12.3 or newer.")
        }
    }

    @objc func stopRecordingAction() {
        if !isRecording { return }
        let mode = recordingMode
        isRecording = false
        recordingMode = nil
        stopBlinking()
        
        if mode == "standard" {
            standardRecorder.stop()
        } else if mode == "meeting" {
            if #available(macOS 12.3, *), let manager = meetingRecorder as? AudioCaptureManager {
                manager.stopCapture()
            }
        }
    }

    func startBlinking() {
        blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let button = self?.statusItem.button else { return }
            button.title = (button.title == "🎙️") ? "🔴" : "🎙️"
        }
    }

    func stopBlinking() {
        blinkTimer?.invalidate(); blinkTimer = nil
        statusItem.button?.title = "🎙️"
    }

    func setupGlobalHotkeys() {
        var startHotKeyRef: EventHotKeyRef?
        var stopHotKeyRef: EventHotKeyRef?
        let gStart = EventHotKeyID(signature: OSType(0x52454353), id: 1)
        let gStop = EventHotKeyID(signature: OSType(0x52454354), id: 2)
        RegisterEventHotKey(UInt32(kVK_ANSI_R), UInt32(controlKey), gStart, GetApplicationEventTarget(), 0, &startHotKeyRef)
        RegisterEventHotKey(UInt32(kVK_ANSI_S), UInt32(controlKey), gStop, GetApplicationEventTarget(), 0, &stopHotKeyRef)
        
        let handler: EventHandlerUPP = { (_, event, nil) -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let d = NSApp.delegate as? AppDelegate
            if hk.id == 1 { d?.startStandardRecording() }
            else if hk.id == 2 { d?.stopRecordingAction() }
            return noErr
        }
        InstallEventHandler(GetApplicationEventTarget(), handler, 1, [EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))], nil, nil)
    }

    func prepareEnvironment() {
        let p = findExecutable("php"), f = findExecutable("ffmpeg")
        DispatchQueue.main.async {
            if p == nil || f == nil { self.showDependencyAlert(hasPhp: p != nil, hasFfmpeg: f != nil); return }
            self.startServer(withPHP: p!, webDir: Bundle.main.resourcePath! + "/web")
        }
    }

    func findExecutable(_ name: String) -> String? {
        let res = shellCommand("/usr/bin/which \(name)")?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let path = res, !path.isEmpty, path.hasPrefix("/") { return path }
        for p in ["/opt/homebrew/bin/\(name)", "/usr/local/bin/\(name)", "/usr/bin/\(name)"] { if FileManager.default.fileExists(atPath: p) { return p } }
        return nil
    }

    func startServer(withPHP phpPath: String, webDir: String) {
        for testPort in 8080...8089 {
            if isPortInUse(port: testPort) {
                print("Port \(testPort) is in use, attempting to kill existing process...")
                let _ = shellCommand("lsof -ti:\(testPort) | xargs kill -9")
                Thread.sleep(forTimeInterval: 0.5)
            }
            if !isPortInUse(port: testPort) {
                port = testPort
                break
            }
        }
        serverProcess = Process(); serverProcess.executableURL = URL(fileURLWithPath: phpPath)
        serverProcess.arguments = ["-d", "upload_max_filesize=1G", "-d", "post_max_size=1G", "-d", "memory_limit=1024M", "-d", "max_execution_time=3600", "-d", "max_input_time=3600", "-S", "localhost:\(port)", "-t", webDir, "-r", "."]
        serverProcess.currentDirectoryURL = URL(fileURLWithPath: webDir); try? serverProcess.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.webView.load(URLRequest(url: URL(string: "http://localhost:\(self.port)/")!)) }
    }

    func isPortInUse(port p: Int) -> Bool { return shellCommand("lsof -Pi :\(p) -sTCP:LISTEN -t >/dev/null 2>&1 && echo '1' || echo '0'")?.trimmingCharacters(in: .whitespacesAndNewlines) == "1" }
    func shellCommand(_ c: String) -> String? {
        let t = Process(); t.executableURL = URL(fileURLWithPath: "/bin/bash"); t.arguments = ["-c", c]
        let p = Pipe(); t.standardOutput = p; try? t.run(); t.waitUntilExit()
        return String(data: p.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
    }

    func getMacAddress() -> String {
        let t = Process(); t.launchPath = "/sbin/ifconfig"; t.arguments = ["en0"]; let p = Pipe(); t.standardOutput = p; t.launch()
        if let out = String(data: p.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) {
            for l in out.components(separatedBy: "\n") where l.contains("ether") {
                for pt in l.trimmingCharacters(in: .whitespaces).components(separatedBy: " ") where pt.contains(":") && pt.count >= 12 { return pt }
            }
        }
        return "Unknown"
    }

    func setupMenuBar() {
        let m = NSMenu(); let am = NSMenuItem(); m.addItem(am); let appM = NSMenu()
        appM.addItem(withTitle: "About AudioAgent", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appM.addItem(NSMenuItem.separator()); appM.addItem(withTitle: "Quit AudioAgent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        am.submenu = appM; let wm = NSMenuItem(); m.addItem(wm); let winM = NSMenu(title: "Window")
        winM.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")); wm.submenu = winM; NSApp.mainMenu = m
    }

    func applyPendingUpdate() {
        let upDir = FileManager.default.temporaryDirectory.appendingPathComponent("AudioAgentUpdate")
        let pendApp = upDir.appendingPathComponent("AudioAgent.app")
        if FileManager.default.fileExists(atPath: pendApp.path) {
            let selfP = Bundle.main.bundleURL.path, sPath = "/tmp/update_swap.sh"
            let script = "#!/bin/bash\nsleep 2\nrm -rf \"\(selfP)\"\ncp -R \"\(pendApp.path)\" \"\(selfP)\"\nrm -rf \"\(upDir.path)\"\nopen \"\(selfP)\""
            try? script.write(toFile: sPath, atomically: true, encoding: .utf8)
            let _ = shellCommand("chmod +x \(sPath) && nohup \(sPath) > /dev/null 2>&1 &"); NSApp.terminate(nil)
        }
    }

    func checkForUpdates() {
        DispatchQueue.global(qos: .background).async {
            guard let url = URL(string: "http://127.0.0.1:\(self.port)/admin/update_api.php") else { return }
            URLSession.shared.dataTask(with: url) { [weak self] d, _, _ in
                guard let self = self, let d = d, let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                      let rv = j["version"] as? String, let us = j["url"] as? String, !us.isEmpty,
                      rv.compare(self.appVersion, options: .numeric) == .orderedDescending else { return }
                self.downloadUpdate(from: us)
            }.resume()
        }
    }

    func downloadUpdate(from us: String) {
        URLSession.shared.downloadTask(with: URL(string: us)!) { [weak self] loc, _, _ in
            guard let self = self, let loc = loc else { return }
            let upDir = FileManager.default.temporaryDirectory.appendingPathComponent("AudioAgentUpdate")
            try? FileManager.default.createDirectory(atPath: upDir.path, withIntermediateDirectories: true)
            let zipP = upDir.appendingPathComponent("update.zip")
            try? FileManager.default.removeItem(at: zipP); try? FileManager.default.moveItem(at: loc, to: zipP)
            let _ = self.shellCommand("/usr/bin/unzip -o \(zipP.path) -d \(upDir.path)")
        }.resume()
    }

    func showDependencyAlert(hasPhp: Bool, hasFfmpeg: Bool) {
        let a = NSAlert(); a.messageText = "Environment Setup Required"; a.informativeText = "AudioAgent needs PHP and FFmpeg installed to function properly."
        a.addButton(withTitle: "Install Now"); a.addButton(withTitle: "Quit")
        if a.runModal() == .alertFirstButtonReturn { runInstallationScript() } else { NSApp.terminate(nil) }
    }

    func runInstallationScript() {
        let s = NSTemporaryDirectory() + "install_audioagent_deps.sh"
        try? "#!/bin/bash\nbrew install php ffmpeg\nread -p 'Done'".write(toFile: s, atomically: true, encoding: .utf8)
        let _ = shellCommand("chmod +x \(s)"); let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        p.arguments = ["-e", "tell application \"Terminal\" to do script \"\(s) && exit\""]; try? p.run(); NSApp.terminate(nil)
    }

    func locateGoogleDrive(email: String) {
        let fileManager = FileManager.default
        let homeDir = fileManager.homeDirectoryForCurrentUser
        let cloudStoragePath = homeDir.appendingPathComponent("Library/CloudStorage")
        
        var potentialPaths: [URL] = []
        // 1. Email specific (New File Provider)
        potentialPaths.append(cloudStoragePath.appendingPathComponent("GoogleDrive-\(email)/My Drive"))
        potentialPaths.append(cloudStoragePath.appendingPathComponent("GoogleDrive-\(email)"))
        // 2. Old style or custom
        potentialPaths.append(homeDir.appendingPathComponent("Google Drive/My Drive"))
        potentialPaths.append(homeDir.appendingPathComponent("Google Drive"))
        // 3. Volume
        potentialPaths.append(URL(fileURLWithPath: "/Volumes/GoogleDrive/My Drive"))
        
        // 4. Wildcard search in CloudStorage
        if let items = try? fileManager.contentsOfDirectory(at: cloudStoragePath, includingPropertiesForKeys: nil) {
            for item in items where item.lastPathComponent.contains("GoogleDrive") {
                potentialPaths.append(item.appendingPathComponent("My Drive"))
                potentialPaths.append(item)
            }
        }
        
        for path in potentialPaths {
            if fileManager.fileExists(atPath: path.path) {
                let sc = "if(window.onGoogleDriveDetected){window.onGoogleDriveDetected('\(path.path.replacingOccurrences(of:"'",with:"\\'"))');}"
                DispatchQueue.main.async { self.webView.evaluateJavaScript(sc, completionHandler: nil) }
                return 
            }
        }
    }

    func openDirectory(path: String) {
        let url = URL(fileURLWithPath: path)
        if FileManager.default.fileExists(atPath: path) {
            NSWorkspace.shared.open(url)
        } else {
            print("Directory not found: \(path)")
        }
    }

    func showAlert(message m: String) { let a = NSAlert(); a.messageText = "AudioAgent"; a.informativeText = m; a.addButton(withTitle: "OK"); a.runModal() }
    override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool { return true }
    override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) { panel.delegate = self; panel.dataSource = self }
    override func endPreviewPanelControl(_ panel: QLPreviewPanel!) { }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { return false }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows f: Bool) -> Bool { if !f { window?.makeKeyAndOrderFront(nil) }; NSApp.activate(ignoringOtherApps: true); return true }
    func applicationWillTerminate(_ n: Notification) { serverProcess?.terminate() }
}

extension AppDelegate: WKNavigationDelegate {
    func webView(_ wv: WKWebView, didFinish n: WKNavigation!) { self.checkForUpdates(); wv.evaluateJavaScript("(function(){document.addEventListener('click',function(e){const t=e.target;if(t.tagName==='INPUT'&&t.type==='file'){window.lastClickedInputId=t.id;e.preventDefault();e.stopPropagation();if(window.webkit?.messageHandlers?.filePicker)window.webkit.messageHandlers.filePicker.postMessage({});return false;}},true);})();", completionHandler: nil) }
}

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) {
        print("WEB_DEBUG: Received message '\(m.name)'")
        if m.name == "filePicker" { showFilePicker(multipleSelection: true) }
        else if m.name == "directoryPicker" { showDirectoryPicker() }
        else if m.name == "linkFilePicker", let b = m.body as? [String: Any], let p = b["path"] as? String { showLinkFilePicker(forAudioPath: p) }
        else if m.name == "locateGoogleDrive", let b = m.body as? [String: Any], let e = b["email"] as? String { locateGoogleDrive(email: e) }
        else if m.name == "openDirectory", let b = m.body as? [String: Any], let p = b["path"] as? String { openInFinder(path: p) }
        else if m.name == "previewFile", let b = m.body as? [String: Any], let p = b["path"] as? String { previewFile(path: p) }
        else if m.name == "shareToIMA", let b = m.body as? [String: Any], let p = b["path"] as? String {
            let prompt = b["prompt"] as? String
            shareFile(path: p, bundleId: "com.tencent.imamac", prompt: prompt)
        }
        else if m.name == "shareToChatGPT", let b = m.body as? [String: Any], let p = b["path"] as? String {
            let prompt = b["prompt"] as? String
            shareFile(path: p, bundleId: "com.openai.chat", prompt: prompt)
        }
        else if m.name == "startRecording" { startStandardRecording() }
        else if m.name == "stopRecording" { stopRecordingAction() }
        else if m.name == "importFiles", let b = m.body as? [String: Any], let dirs = b["directories"] as? [String] { importFiles(knownDirs: dirs) }
        else if m.name == "createCalendarEvent", let data = m.body as? [String: Any],
           let title = data["title"] as? String,
           let startTs = data["startDate"] as? Double,
           let duration = data["duration"] as? Double {
            
            let notes = data["notes"] as? String ?? ""
            let startDate = Date(timeIntervalSince1970: startTs)
            
            CalendarManager.shared.createEvent(title: title, startDate: startDate, duration: duration, notes: notes) { success, error in
                print("Calendar event created: \(success) \(error ?? "")")
            }
        }
    }
    
    func importFiles(knownDirs: [String]) {
        let op = NSOpenPanel()
        op.allowsMultipleSelection = true
        op.canChooseDirectories = false
        op.canChooseFiles = true
        op.allowedFileTypes = ["mp3", "m4a", "m4b", "aac", "ogg", "flac", "wav", "pdf", "doc", "docx", "txt", "md", "pages"]
        
        op.begin { [weak self] res in
            guard let self = self, res == .OK else { return }
            
            var importedCount = 0
            var skippedCount = 0
            let recordDirURL = URL(fileURLWithPath: self.recordDir)
            
            for url in op.urls {
                let path = url.path
                // Check if file is in known directories
                var alreadyExists = false
                for dir in knownDirs {
                    if path.hasPrefix(dir) {
                        alreadyExists = true
                        break
                    }
                }
                
                // Also check if strictly equal to recordDir (though checking prefix covers it usually, but let's be safe)
                if !alreadyExists && path.hasPrefix(self.recordDir) {
                    alreadyExists = true
                }
                
                if alreadyExists {
                    skippedCount += 1
                    continue
                }
                
                // Copy to official directory
                let fileName = url.lastPathComponent
                var destURL = recordDirURL.appendingPathComponent(fileName)
                
                // Handle Name Collision
                if FileManager.default.fileExists(atPath: destURL.path) {
                    let name = url.deletingPathExtension().lastPathComponent
                    let ext = url.pathExtension
                    let timestamp = Int(Date().timeIntervalSince1970)
                    destURL = recordDirURL.appendingPathComponent("\(name)_\(timestamp).\(ext)")
                }
                
                do {
                    try FileManager.default.copyItem(at: url, to: destURL)
                    importedCount += 1
                } catch {
                    print("Error copying file \(url.path): \(error)")
                }
            }
            
            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("window.onImportFinished(\(importedCount), \(skippedCount));", completionHandler: nil)
            }
        }
    }
    func shareFile(path: String, bundleId: String, prompt: String? = nil) {
        print("WEB_DEBUG: Sharing \(path) with \(bundleId)")
        if let promptText = prompt, !promptText.isEmpty {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(promptText, forType: .string)
            print("WEB_DEBUG: Prompt copied to clipboard")
        }
        
        let url = URL(fileURLWithPath: path)
        
        // Try to open directly with target app
        if let appUrl = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
            let config = NSWorkspace.OpenConfiguration()
            
            NSWorkspace.shared.open([url], withApplicationAt: appUrl, configuration: config) { app, error in
                if let error = error {
                    print("Failed to open file with app: \(error)")
                }
            }
        } else {
            // Fallback: Open with default app
            NSWorkspace.shared.open(url)
        }
    }
}


extension AppDelegate {
    func openInFinder(path: String) {
        NSWorkspace.shared.selectFile(path, inFileViewerRootedAtPath: "")
    }
    func previewFile(path: String) {
        let url = URL(fileURLWithPath: path)
        self.previewURL = url
        
        DispatchQueue.main.async { [weak self] in
             guard let self = self else { return }
            if let panel = QLPreviewPanel.shared() {
                if QLPreviewPanel.sharedPreviewPanelExists() && panel.isVisible {
                    panel.orderOut(nil)
                } else {
                    panel.dataSource = self
                    panel.delegate = self
                    panel.makeKeyAndOrderFront(nil)
                }
            }
        }
    }

    // --- QuickLook Data Source ---
    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
        return previewURL == nil ? 0 : 1
    }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        return previewURL as QLPreviewItem?
    }


    func showLinkFilePicker(forAudioPath p: String) {
        let op = NSOpenPanel(); op.allowedFileTypes = ["pdf", "md", "txt"]
        op.begin { [weak self] res in
            guard let self = self, res == .OK, let u = op.url else { return }
            var t = ""; if u.pathExtension.lowercased() == "pdf" { if let pd = PDFDocument(url: u) { for i in 0..<min(pd.pageCount, 5) { t += (pd.page(at: i)?.string ?? "") + " " } } } else { t = (try? String(contentsOf: u, encoding: .utf8)) ?? "" }
            let sm = String(t.prefix(200)).replacingOccurrences(of: "\n", with: " ")
            self.webView.evaluateJavaScript("if(window.onFileLinked){window.onFileLinked('\(p.replacingOccurrences(of:"'",with:"\\'"))','\(sm.replacingOccurrences(of:"'",with:"\\'"))','\(u.path.replacingOccurrences(of:"'",with:"\\'"))');}", completionHandler: nil)
        }
    }
    func showDirectoryPicker() {
        let op = NSOpenPanel(); op.canChooseDirectories = true; op.canChooseFiles = false
        op.begin { [weak self] res in guard let self = self, res == .OK, let u = op.url else { return }; self.webView.evaluateJavaScript("if(window.onDirectorySelected){window.onDirectorySelected('\(u.path.replacingOccurrences(of:"'",with:"\\'"))');}", completionHandler: nil) }
    }
    func showFilePicker(multipleSelection m: Bool) {
        let op = NSOpenPanel(); op.allowsMultipleSelection = m;
        // op.allowedFileTypes = ["mp3", "mp4", "m4a", "m4b", "aac", "ogg", "flac"] // Removed to support All Files/Docs
        op.begin { [weak self] res in 
            guard let self = self, res == .OK else { return }
            let f = op.urls.map { url -> [String: Any] in
                let attr = try? FileManager.default.attributesOfItem(atPath: url.path)
                let size = attr?[.size] as? Int64 ?? 0
                let mtime = (attr?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? Date().timeIntervalSince1970
                return [
                    "name": url.lastPathComponent,
                    "path": url.path,
                    "size": size,
                    "mtime": mtime
                ]
            }
            if let d = try? JSONSerialization.data(withJSONObject: f), let s = String(data: d, encoding: .utf8) {
                // Ensure UI updates are on main thread if needed
                DispatchQueue.main.async {
                    self.webView.evaluateJavaScript("if(window.selectedFilesCallback){window.selectedFilesCallback(\(s));}", completionHandler: nil)
                }
            }
        }
    }
    }


extension AppDelegate: WKUIDelegate {
    func webView(_ wv: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures wf: WKWindowFeatures) -> WKWebView? { if let url = a.request.url { if url.host?.contains("google.com") == true { let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 700), styleMask: [.titled, .closable], backing: .buffered, defer: false); win.center(); win.title = "Google Login"; win.isReleasedWhenClosed = false; let wv = WKWebView(frame: win.contentView!.bounds, configuration: c); wv.uiDelegate = self; wv.navigationDelegate = self; win.contentView?.addSubview(wv); win.makeKeyAndOrderFront(nil); return wv }; NSWorkspace.shared.open(url) }; return nil }
    func webView(_ wv: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping () -> Void) { let a = NSAlert(); a.messageText = "AudioAgent"; a.informativeText = m; a.addButton(withTitle: "OK"); a.runModal(); ch() }
    func webView(_ wv: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler ch: @escaping (Bool) -> Void) { let a = NSAlert(); a.messageText = "AudioAgent"; a.informativeText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel"); ch(a.runModal() == .alertFirstButtonReturn) }
    func webViewDidClose(_ wv: WKWebView) { wv.window?.close() }
}






class CalendarManager: NSObject {
    static let shared = CalendarManager()
    let eventStore = EKEventStore()
    
    func createEvent(title: String, startDate: Date, duration: TimeInterval, notes: String, completion: @escaping (Bool, String?) -> Void) {
         eventStore.requestAccess(to: .event) { [weak self] granted, error in
            self?.handleAccessResponse(granted: granted, error: error, title: title, startDate: startDate, duration: duration, notes: notes, completion: completion)
        }
    }
    
    private func handleAccessResponse(granted: Bool, error: Error?, title: String, startDate: Date, duration: TimeInterval, notes: String, completion: @escaping (Bool, String?) -> Void) {
        if let error = error {
            completion(false, error.localizedDescription)
            return
        }
        
        if !granted {
            completion(false, "Calendar access denied")
            return
        }
        
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let event = EKEvent(eventStore: self.eventStore)
            event.title = title
            event.startDate = startDate
            event.endDate = startDate.addingTimeInterval(duration)
            event.notes = notes
            event.calendar = self.eventStore.defaultCalendarForNewEvents
            
            do {
                try self.eventStore.save(event, span: .thisEvent)
                completion(true, nil)
            } catch {
                completion(false, error.localizedDescription)
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()


