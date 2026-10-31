package expo.modules.blemesh;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class PeripheralManager {
    private static final String TAG = "PeripheralManager";
    // The exact same "secret password" used in CentralManager
    private static final UUID SERVICE_UUID = UUID.fromString("7B3C1A80-9F42-4E17-9A6D-2C5E8B1F0D31");
    // The exact same mailbox UUID used in CentralManager
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("8C4D2B91-0E53-5F28-AB7E-3D6F9C2E1E42");
    private static final UUID CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private OnDataReceivedListener dataListener;

    public void setOnDataReceivedListener(OnDataReceivedListener listener) {
        this.dataListener = listener;
    }

    private Context context;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeAdvertiser advertiser;
    private boolean isAdvertising = false;
    private BluetoothGattServer gattServer;
    private BluetoothGattCharacteristic dataPipe;
    private final Set<BluetoothDevice> connectedCentrals = ConcurrentHashMap.newKeySet();

    public interface MeshEventListener {
        void onPeerConnected(String peerId);
        void onMessageReceived(String base64Bytes);
        void onDeviceDisconnected(String peerId);
    }

    private MeshEventListener listener;

    public void setListener(MeshEventListener listener) {
        this.listener = listener;
    }

    public PeripheralManager(Context context) {
        this.context = context;
        BluetoothManager bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            this.bluetoothAdapter = bluetoothManager.getAdapter();
        }
    }

    public boolean hasConnectedCentrals() {
        return !connectedCentrals.isEmpty();
    }

    @SuppressLint("MissingPermission")
    public boolean sendData(String base64Bytes) {
        if (gattServer == null || dataPipe == null || connectedCentrals.isEmpty()) {
            Log.w(TAG, "Cannot notify: gattServer null or no connected centrals");
            return false;
        }

        try {
            byte[] rawBytes = Base64.decode(base64Bytes, Base64.NO_WRAP);
            dataPipe.setValue(rawBytes);
            boolean anySuccess = false;
            for (BluetoothDevice device : connectedCentrals) {
                boolean sent = gattServer.notifyCharacteristicChanged(device, dataPipe, false);
                Log.d(TAG, "Notified central " + device.getAddress() + ": " + sent);
                if (sent) {
                    anySuccess = true;
                }
            }
            return anySuccess;
        } catch (Exception e) {
            Log.e(TAG, "Error notifying centrals", e);
            return false;
        }
    }

    @SuppressLint("MissingPermission")
    public void startServer() {
        if (gattServer != null) {
            return;
        }

        BluetoothManager bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager == null) return;

        gattServer = bluetoothManager.openGattServer(context, gattServerCallback);

        dataPipe = new BluetoothGattCharacteristic(
                CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
        );

        BluetoothGattDescriptor cccdDescriptor = new BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE
        );
        dataPipe.addDescriptor(cccdDescriptor);

        BluetoothGattService service = new BluetoothGattService(
                SERVICE_UUID,
                BluetoothGattService.SERVICE_TYPE_PRIMARY
        );

        service.addCharacteristic(dataPipe);
        if (gattServer != null) {
            gattServer.addService(service);
            Log.d(TAG, "GATT Server started. Mailbox is ready to receive and notify bytes.");
        }
    }

    @SuppressLint("MissingPermission")
    public void startAdvertising() {
        if (isAdvertising) {
            return;
        }

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Log.e(TAG, "Bluetooth is disabled or not supported");
            return;
        }

        advertiser = bluetoothAdapter.getBluetoothLeAdvertiser();
        if (advertiser == null) return;

        startServer();

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build();

        AdvertiseData data = new AdvertiseData.Builder()
                .addServiceUuid(new ParcelUuid(SERVICE_UUID))
                .build();

        Log.d(TAG, "Starting BLE Advertising...");

        advertiser.startAdvertising(settings, data, advertiseCallback);
        isAdvertising = true;
    }

    @SuppressLint("MissingPermission")
    public void stopAdvertising() {
        if (isAdvertising && advertiser != null) {
            advertiser.stopAdvertising(advertiseCallback);
            isAdvertising = false;
        }
        if (gattServer != null) {
            gattServer.close();
            gattServer = null;
        }
        connectedCentrals.clear();
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override
        public void onStartSuccess(AdvertiseSettings settingsInEffect) {
            super.onStartSuccess(settingsInEffect);
            Log.d(TAG, "Advertising started successfully! Other phones can now see us.");
        }

        @Override
        public void onStartFailure(int errorCode) {
            super.onStartFailure(errorCode);
            Log.e(TAG, "Advertising failed with error code: " + errorCode);
        }
    };

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            super.onConnectionStateChange(device, status, newState);
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedCentrals.add(device);
                String address = device.getAddress();
                Log.d(TAG, "A Central device connected to our server: " + address);
                if (listener != null) {
                    listener.onPeerConnected(address);
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedCentrals.remove(device);
                String address = device.getAddress();
                Log.d(TAG, "Device disconnected: " + address);

                if (listener != null) {
                    listener.onDeviceDisconnected(address);
                }
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId, BluetoothGattCharacteristic characteristic, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value);

            if (CHARACTERISTIC_UUID.equals(characteristic.getUuid())) {
                String base64Bytes = Base64.encodeToString(value, Base64.NO_WRAP);
                Log.d(TAG, "Received encrypted message! Base64 Payload: " + base64Bytes);

                if (responseNeeded && gattServer != null) {
                    gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
                }

                if (listener != null) {
                    listener.onMessageReceived(base64Bytes);
                }
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId, BluetoothGattDescriptor descriptor, boolean preparedWrite, boolean responseNeeded, int offset, byte[] value) {
            super.onDescriptorWriteRequest(device, requestId, descriptor, preparedWrite, responseNeeded, offset, value);
            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value);
            }
        }
    };
}