package expo.modules.blemesh

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BleMeshModule : Module() {

  private val centralManager by lazy {
    appContext.reactContext?.let { context ->
      val manager = CentralManager(context)
      
      manager.setListener(object : CentralManager.CentralEventListener {
        override fun onPeerDiscovered(peerId: String, rssi: Int) {
          sendEvent("onPeerDiscovered", mapOf(
            "peerId" to peerId,
            "rssi" to rssi
          ))
        }

        override fun onPeerConnected(peerId: String) {
          sendEvent("onPeerConnected", mapOf("peerId" to peerId))
        }

        override fun onMessageReceived(base64Bytes: String) {
          sendEvent("onRawData", mapOf("base64Bytes" to base64Bytes, "payload" to base64Bytes))
        }

        override fun onDeviceDisconnected(peerId: String) {
          sendEvent("onDeviceDisconnected", mapOf("peerId" to peerId))
        }
      })
      
      manager
    }
  }

  private val peripheralManager by lazy {
    appContext.reactContext?.let { context ->
      val manager = PeripheralManager(context)
      
      manager.setListener(object : PeripheralManager.MeshEventListener {
        override fun onPeerConnected(peerId: String) {
          sendEvent("onPeerConnected", mapOf("peerId" to peerId))
        }

        override fun onMessageReceived(base64Bytes: String) {
          sendEvent("onRawData", mapOf("base64Bytes" to base64Bytes, "payload" to base64Bytes))
        }

        override fun onDeviceDisconnected(peerId: String) {
          sendEvent("onDeviceDisconnected", mapOf("peerId" to peerId))
        }
      })
      
      manager
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BleMesh")

    Events("onRawData", "onPeerDiscovered", "onPeerConnected", "onDeviceDisconnected")

    Function("startRadio") {
      centralManager?.startScanning()
      peripheralManager?.startAdvertising()
    }
    
    Function("stopRadio") {
      centralManager?.stopScanning()
      peripheralManager?.stopAdvertising()
    }

    Function("writeRaw") { peerId: String, base64Bytes: String ->
      var sent = false
      if (centralManager?.isConnected == true) {
        centralManager?.writeRawData(base64Bytes)
        sent = true
      }
      if (peripheralManager?.hasConnectedCentrals() == true) {
        peripheralManager?.sendData(base64Bytes)
        sent = true
      }
      if (!sent) {
        centralManager?.writeRawData(base64Bytes)
      }
    }
  }
}