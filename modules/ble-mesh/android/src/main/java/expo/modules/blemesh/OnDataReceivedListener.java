package expo.modules.blemesh;

public interface OnDataReceivedListener {
    void onDataReceived(String peerAddress, String base64Bytes);
}
