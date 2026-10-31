package expo.modules.blemesh;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class CentralManager {
    private static final String TAG = "CentralManager";
    private static final UUID SERVICE_UUID = UUID.fromString("7B3C1A80-9F42-4E17-9A6D-2C5E8B1F0D31");
    private static final UUID CHARACTERISTIC_UUID = UUID.fromString("8C4D2B91-0E53-5F28-AB7E-3D6F9C2E1E42");
    
    private BluetoothGattCharacteristic dataPipe;
    private Context context;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    private boolean isScanning = false;
    private BluetoothGatt bluetoothGatt;

    public interface CentralEventListener {
        void onPeerDiscovered(String peerId, int rssi);
        void onPeerConnected(String peerId);
        void onMessageReceived(String base64Bytes);
        void onDeviceDisconnected(String peerId);
    }
    
    private CentralEventListener connectionListener;

    public void setListener(CentralEventListener listener) {
        this.connectionListener = listener;
    }

    public boolean isConnected() {
        return bluetoothGatt != null && dataPipe != null;
    }

    public CentralManager(Context context) {
        this.context = context;
        BluetoothManager bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            this.bluetoothAdapter = bluetoothManager.getAdapter();
        }
    }

    @SuppressLint("MissingPermission")
    public void startScanning() {
        if (isScanning) return;
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
            Log.e(TAG, "Bluetooth is disabled or not supported");
            return;
        }

        bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();
        if (bluetoothLeScanner == null) return;

        List<ScanFilter> filters = new ArrayList<>();

        ScanSettings settings = new ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build();

        Log.d(TAG, "Starting BLE Scan...");
        bluetoothLeScanner.startScan(filters, settings, scanCallback);
        isScanning = true;
    }

    @SuppressLint("MissingPermission")
    public void stopScanning() {
        if (isScanning && bluetoothLeScanner != null) {
            bluetoothLeScanner.stopScan(scanCallback);
            isScanning = false;
        }
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            super.onScanResult(callbackType, result);
            
            boolean isEcho = false;
            if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null) {
                for (ParcelUuid uuid : result.getScanRecord().getServiceUuids()) {
                    if (SERVICE_UUID.equals(uuid.getUuid())) {
                        isEcho = true;
                        break;
                    }
                }
            }
            if (!isEcho) return;

            BluetoothDevice device = result.getDevice();
            String address = device.getAddress();

            if (connectionListener != null) {
                connectionListener.onPeerDiscovered(address, result.getRssi());
            }

            if (bluetoothGatt == null) {
                Log.d(TAG, "Connecting to Echo peer: " + address);
                stopScanning();
                bluetoothGatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            }
        }

        @Override
        public void onScanFailed(int errorCode) {
            Log.e(TAG, "Scan failed with error code: " + errorCode);
            isScanning = false;
        }
    };

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        @Override
        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
            super.onConnectionStateChange(gatt, status, newState);
            
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "Successfully connected to " + gatt.getDevice().getAddress());
                boolean requested = gatt.requestMtu(517);
                if (!requested) {
                    Log.w(TAG, "requestMtu returned false, discovering services immediately");
                    gatt.discoverServices();
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                String address = gatt.getDevice().getAddress();
                Log.d(TAG, "Disconnected from " + address);
                
                if (bluetoothGatt != null) {
                    bluetoothGatt.close();
                    bluetoothGatt = null;
                }
                
                if (connectionListener != null) {
                    connectionListener.onDeviceDisconnected(address);
                }
                
                Log.d(TAG, "Restarting scanner to find new peers...");
                startScanning();
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
            super.onMtuChanged(gatt, mtu, status);
            Log.d(TAG, "MTU expanded to: " + mtu);
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                gatt.discoverServices();
            } else {
                Log.e(TAG, "MTU expansion failed, discovering services anyway.");
                gatt.discoverServices();
            }
        }

        @SuppressLint("MissingPermission")
        @Override
        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
            super.onServicesDiscovered(gatt, status);
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                BluetoothGattService service = gatt.getService(SERVICE_UUID);
                
                if (service != null) {
                    dataPipe = service.getCharacteristic(CHARACTERISTIC_UUID);
                    
                    if (dataPipe != null) {
                        dataPipe.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                        gatt.setCharacteristicNotification(dataPipe, true);
                        UUID cccdUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
                        android.bluetooth.BluetoothGattDescriptor descriptor = dataPipe.getDescriptor(cccdUuid);
                        if (descriptor != null) {
                            descriptor.setValue(android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            gatt.writeDescriptor(descriptor);
                        }
                        Log.d(TAG, "Data pipe found! Connection established and notifications enabled.");
                        
                        if (connectionListener != null) {
                            connectionListener.onPeerConnected(gatt.getDevice().getAddress());
                        }
                    } else {
                        Log.e(TAG, "Service found, but data pipe is missing.");
                    }
                } else {
                    Log.e(TAG, "Echo service not found on this device.");
                }
            } else {
                Log.w(TAG, "Service discovery failed with status: " + status);
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
            super.onCharacteristicChanged(gatt, characteristic);
            byte[] value = characteristic.getValue();
            if (value != null && value.length > 0) {
                String base64Bytes = Base64.encodeToString(value, Base64.NO_WRAP);
                Log.d(TAG, "Received notification data as Central! Base64: " + base64Bytes);
                if (connectionListener != null) {
                    connectionListener.onMessageReceived(base64Bytes);
                }
            }
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, byte[] value) {
            super.onCharacteristicChanged(gatt, characteristic, value);
            if (value != null && value.length > 0) {
                String base64Bytes = Base64.encodeToString(value, Base64.NO_WRAP);
                Log.d(TAG, "Received notification data as Central (Tiramisu)! Base64: " + base64Bytes);
                if (connectionListener != null) {
                    connectionListener.onMessageReceived(base64Bytes);
                }
            }
        }
    };

    @SuppressLint("MissingPermission")
    public void writeRawData(String base64Bytes) {
        if (bluetoothGatt == null || dataPipe == null) {
            Log.e(TAG, "Cannot send data. Not connected or data pipe missing.");
            return;
        }

        try {
            byte[] rawBytes = Base64.decode(base64Bytes, Base64.NO_WRAP);
            dataPipe.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            dataPipe.setValue(rawBytes);
            
            boolean success = bluetoothGatt.writeCharacteristic(dataPipe);
            
            if (success) {
                Log.d(TAG, "Successfully pushed bytes to the hardware buffer!");
            } else {
                Log.e(TAG, "Hardware rejected the write command.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to decode and send data: " + e.getMessage());
        }
    }
}