import SwiftUI

struct ContentView: View {
    @StateObject var recorder = AudioRecorder()
    @StateObject var sender = WirelessSenderManager()
    
    var body: some View {
        VStack(spacing: 40) {
            Text("AudioAgent iPhone")
                .font(.largeTitle)
                .bold()
            
            HStack {
                Circle()
                    .fill(sender.isConnected ? Color.green : Color.red)
                    .frame(width: 12, height: 12)
                Text(sender.isConnected ? "已通过蓝牙连接到 Mac" : "正在寻找 Mac App...")
                    .foregroundColor(.secondary)
            }
            
            if recorder.isRecording {
                Text("正在录音...")
                    .font(.title2)
                    .foregroundColor(.red)
                    .scaleEffect(recorder.isRecording ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 0.5).repeatForever(), value: recorder.isRecording)
            }
            
            Button(action: {
                if recorder.isRecording {
                    recorder.stopRecording()
                    // 录音一结束即尝试发送
                    if let url = recorder.recordedURL {
                        sender.sendFile(at: url)
                    }
                } else {
                    recorder.startRecording()
                }
            }) {
                ZStack {
                    Circle()
                        .fill(recorder.isRecording ? Color.red : Color.blue)
                        .frame(width: 100, height: 100)
                    Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.white)
                }
            }
            
            if let error = sender.lastError {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
            }
            
            Spacer()
            
            Text("点击按钮录音，停止后将自动极速传回 Mac")
                .multilineTextAlignment(.center)
                .padding()
                .foregroundColor(.gray)
        }
        .padding()
        .onAppear {
            sender.start()
        }
    }
}
