import Foundation
import MultipeerConnectivity

class WirelessSenderManager: NSObject, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate {
    private let serviceType = "audioagent-xfer"
    private let myPeerId = MCPeerID(displayName: UIDevice.current.name)
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    
    @Published var isConnected = false
    @Published var lastError: String?
    @Published var transferProgress: Double = 0
    
    override init() {
        super.init()
        session = MCSession(peer: myPeerId, securityIdentity: nil, encryptionPreference: .required)
        session?.delegate = self
        
        advertiser = MCNearbyServiceAdvertiser(peer: myPeerId, discoveryInfo: nil, serviceType: serviceType)
        advertiser?.delegate = self
    }
    
    func start() {
        advertiser?.startAdvertisingPeer()
    }
    
    func stop() {
        advertiser?.stopAdvertisingPeer()
        session?.disconnect()
    }
    
    func sendFile(at url: URL) {
        guard let session = session, !session.connectedPeers.isEmpty else {
            self.lastError = "未连接到 Mac"
            return
        }
        
        for peer in session.connectedPeers {
            session.sendResource(at: url, withName: url.lastPathComponent, toPeer: peer) { error in
                if let error = error {
                    DispatchQueue.main.async {
                        self.lastError = "发送失败: \(error.localizedDescription)"
                    }
                } else {
                    print("文件发送成功")
                }
            }
        }
    }
    
    // MARK: - MCNearbyServiceAdvertiserDelegate
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        print("收到来自 \(peerID.displayName) 的连接邀请，正在接受...")
        invitationHandler(true, session)
    }
    
    // MARK: - MCSessionDelegate
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        DispatchQueue.main.async {
            self.isConnected = (state == .connected)
        }
    }
    
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
