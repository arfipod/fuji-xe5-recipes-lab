#!/usr/bin/env python3
"""Policy-locked, serial-redacting USB/PTP laboratory for the physical X-E5.

The CLI deliberately exposes only bounded read-only workflows. It does not
depend on gphoto2, never requests the USB serial string, never emits the serial
inside DeviceInfo, and always releases the claimed interface in ``finally``.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import hashlib
import json
import struct
import sys
import time
from dataclasses import dataclass
from typing import Any


FUJI_VENDOR_ID = 0x04CB
X_E5_PRODUCT_ID = 0x0313

PTP_COMMAND = 1
PTP_DATA = 2
PTP_RESPONSE = 3

GET_DEVICE_INFO = 0x1001
OPEN_SESSION = 0x1002
CLOSE_SESSION = 0x1003
GET_OBJECT_INFO = 0x1008
GET_OBJECT = 0x1009
GET_DEVICE_PROP_DESC = 0x1014
GET_DEVICE_PROP_VALUE = 0x1015
SET_DEVICE_PROP_VALUE = 0x1016
PTP_OK = 0x2001

FUJI_USB_MODE = 0xD16E
BACKUP_HANDLE = 0
BACKUP_FORMAT = 0x5000
X_E5_BACKUP_SIZE = 70524
FS_CHECKSUM_OFFSET = 0x120
FS1_RECIPE_ENABLED_OFFSET = 34500
FS3_RECIPE_ENABLED_OFFSET = 34502
FS_RECIPE_ENABLED_OFFSETS = {0: FS1_RECIPE_ENABLED_OFFSET, 2: FS3_RECIPE_ENABLED_OFFSET}

FS1_PHYSICAL_TARGET_RAW = {
    "filmSimulation": 0x0F,
    "whiteBalanceKelvin": 5200,
    "whiteBalanceMode": 0x0A,
    "highIsoNr": 0x00,
    "clarity": 0x04,
    "dynamicRange": 0x03,
    "color": 0x05,
    "sharpness": 0x06,
    "highlight": 0x04,
    "shadow": 0x00,
    "colorChrome": 0x02,
    "colorChromeBlue": 0x00,
    "grainStrength": 0x00,
    "grainSize": 0x00,
    "smoothSkin": 0x00,
    "wbShiftR": 0x08,
    "wbShiftB": 0x0F,
}
FS1_PHYSICAL_TARGET_VALUES = {
    "filmSimulation": "ClassicChrome", "whiteBalanceKelvin": 5200,
    "whiteBalanceMode": "Temperature", "highIsoNr": -4, "clarity": -2,
    "dynamicRange": "DR400", "color": 2, "sharpness": -2,
    "highlight": 0, "shadow": -2, "colorChrome": "Strong",
    "colorChromeBlue": "Off", "grainStrength": "Strong", "grainSize": "Small",
    "smoothSkin": "Off", "wbShiftR": 1, "wbShiftB": -6,
}
FS2_PHYSICAL_TARGET_RAW = {
    "filmSimulation": 0x0F, "whiteBalanceKelvin": 3200,
    "whiteBalanceMode": 0x0A, "highIsoNr": 0x02,
    "dynamicRange": 0x03, "color": 0x07, "sharpness": 0x05,
    "highlight": 0x08, "shadow": 0x08, "wbShiftR": 0x01, "wbShiftB": 0x11,
}
FS2_PHYSICAL_TARGET_VALUES = {
    "filmSimulation": "ClassicChrome", "whiteBalanceKelvin": 3200,
    "whiteBalanceMode": "Temperature", "highIsoNr": -2,
    "dynamicRange": "DR200", "color": -2, "sharpness": -1,
    "highlight": 2, "shadow": 2, "wbShiftR": 8, "wbShiftB": -8,
}
FS3_PHYSICAL_TARGET_RAW = {
    "filmSimulation": 0x16, "whiteBalanceMode": 0x00,
    "highIsoNr": 0x00, "clarity": 0x0B,
    "monoWarmCool": 0x12, "monoMagentaGreen": 0x12,
    "dynamicRange": 0x00, "sharpness": 0x08,
    "highlight": 0x0C, "shadow": 0x08,
    "colorChrome": 0x00, "colorChromeBlue": 0x00,
    "grainStrength": 0x00, "grainSize": 0x01,
    "wbShiftR": 0x01, "wbShiftB": 0x11,
}
FS3_PHYSICAL_TARGET_VALUES = {
    "filmSimulation": "Acros", "whiteBalanceMode": "Auto",
    "highIsoNr": -4, "clarity": 5,
    "monoWarmCool": 0, "monoMagentaGreen": 0,
    "dynamicRange": "Auto", "sharpness": -4,
    "highlight": 4, "shadow": 2,
    "colorChrome": "Off", "colorChromeBlue": "Off",
    "grainStrength": "Strong", "grainSize": "Large",
    "wbShiftR": 0, "wbShiftB": 0,
}
FS_PHYSICAL_TARGETS = {
    0: (FS1_PHYSICAL_TARGET_RAW, FS1_PHYSICAL_TARGET_VALUES,
        "Enabled FS1 owner-menu target and guarded volatile backup reads on 2026-08-02/03."),
    1: (FS2_PHYSICAL_TARGET_RAW, FS2_PHYSICAL_TARGET_VALUES,
        "Enabled FS2 owner-menu target and guarded read-only backup on 2026-08-03; DR200 and Color -2 are slot-scoped physical mappings."),
    2: (FS3_PHYSICAL_TARGET_RAW, FS3_PHYSICAL_TARGET_VALUES,
        "Enabled plain-ACROS FS3 owner-menu target and guarded volatile backup comparisons on 2026-08-03; WB raw 01/11 is neutral R0/B0 only for FS3."),
}

MAX_CONTAINER_SIZE = 1024 * 1024
USB_TIMEOUT_MS = 5000

OPERATION_NAMES = {
    0x1001: "GET_DEVICE_INFO",
    0x1002: "OPEN_SESSION",
    0x1003: "CLOSE_SESSION",
    0x1004: "GET_STORAGE_IDS",
    0x1005: "GET_STORAGE_INFO",
    0x1006: "GET_NUM_OBJECTS",
    0x1007: "GET_OBJECT_HANDLES",
    0x1008: "GET_OBJECT_INFO",
    0x1009: "GET_OBJECT",
    0x100A: "GET_THUMB",
    0x100B: "DELETE_OBJECT (PROHIBITED)",
    0x100C: "SEND_OBJECT_INFO (PROHIBITED)",
    0x100D: "SEND_OBJECT (PROHIBITED)",
    0x100F: "FORMAT_STORE (PROHIBITED)",
    0x1014: "GET_DEVICE_PROP_DESC",
    0x1015: "GET_DEVICE_PROP_VALUE",
    0x1016: "SET_DEVICE_PROP_VALUE (RESTRICTED)",
    0x101B: "GET_PARTIAL_OBJECT",
    0x900C: "FUJI_SEND_OBJECT_INFO (PROHIBITED)",
    0x900D: "FUJI_SEND_OBJECT_2 (PROHIBITED)",
    0x901D: "VENDOR_OPERATION_0x901D (UNKNOWN)",
    0x9801: "MTP_GET_OBJECT_PROPS_SUPPORTED",
    0x9802: "MTP_GET_OBJECT_PROP_DESC",
    0x9803: "MTP_GET_OBJECT_PROP_VALUE",
    0x9805: "MTP_GET_OBJECT_PROP_LIST",
}

EVENT_NAMES = {
    0x4002: "OBJECT_ADDED",
    0x4003: "OBJECT_REMOVED",
    0x4004: "STORE_ADDED",
    0x4005: "STORE_REMOVED",
    0x4006: "DEVICE_PROP_CHANGED",
    0x4008: "DEVICE_INFO_CHANGED",
    0x4009: "REQUEST_OBJECT_TRANSFER",
}

PROPERTY_NAMES = {
    0x5001: "BATTERY_LEVEL",
    0xD041: "VENDOR_PROPERTY_0xD041 (UNKNOWN)",
    0xD303: "VENDOR_PROPERTY_0xD303 (UNKNOWN)",
    0xD406: "MTP_SESSION_INITIATOR_INFO",
    0xD407: "MTP_PERCEIVED_DEVICE_TYPE",
    0xD16E: "FUJI_USB_MODE",
    0xD18C: "FUJI_RECIPE_SELECTOR",
    0xD18D: "FUJI_RECIPE_NAME",
    0xD18E: "FUJI_RECIPE_IMAGE_SIZE",
    0xD18F: "FUJI_RECIPE_IMAGE_QUALITY",
    0xD190: "FUJI_RECIPE_DYNAMIC_RANGE",
    0xD191: "FUJI_RECIPE_D_RANGE_PRIORITY",
    0xD192: "FUJI_RECIPE_FILM_SIMULATION",
    0xD193: "FUJI_RECIPE_MONO_WARM_COOL",
    0xD194: "FUJI_RECIPE_MONO_MAGENTA_GREEN",
    0xD195: "FUJI_RECIPE_GRAIN",
    0xD196: "FUJI_RECIPE_COLOR_CHROME",
    0xD197: "FUJI_RECIPE_COLOR_CHROME_BLUE",
    0xD198: "FUJI_RECIPE_SMOOTH_SKIN",
    0xD199: "FUJI_RECIPE_WHITE_BALANCE",
    0xD19A: "FUJI_RECIPE_WB_SHIFT_RED",
    0xD19B: "FUJI_RECIPE_WB_SHIFT_BLUE",
    0xD19C: "FUJI_RECIPE_COLOR_TEMPERATURE",
    0xD19D: "FUJI_RECIPE_HIGHLIGHT",
    0xD19E: "FUJI_RECIPE_SHADOW",
    0xD19F: "FUJI_RECIPE_COLOR",
    0xD1A0: "FUJI_RECIPE_SHARPNESS",
    0xD1A1: "FUJI_RECIPE_HIGH_ISO_NR",
    0xD1A2: "FUJI_RECIPE_CLARITY",
    0xD1A3: "FUJI_RECIPE_LONG_EXPOSURE_NR",
    0xD1A4: "FUJI_RECIPE_COLOR_SPACE",
    0xD1A5: "FUJI_RECIPE_BODY_SPECIFIC_D1A5",
}

FUJI_USB_MODE_NAMES = {
    5: "USB_TETHER_SHOOTING",
    6: "USB_RAW_CONVERSION_BACKUP_RESTORE",
    8: "USB_WEBCAM",
}

RESPONSE_NAMES = {
    0x2001: "OK",
    0x2002: "GENERAL_ERROR",
    0x2003: "SESSION_NOT_OPEN",
    0x2004: "INVALID_TRANSACTION_ID",
    0x2005: "OPERATION_NOT_SUPPORTED",
    0x2006: "PARAMETER_NOT_SUPPORTED",
    0x2007: "INCOMPLETE_TRANSFER",
    0x2009: "INVALID_OBJECT_HANDLE",
    0x200A: "DEVICE_PROP_NOT_SUPPORTED",
    0x200F: "ACCESS_DENIED (POSSIBLY VENDOR-OVERLOADED)",
    0x2019: "DEVICE_BUSY",
    0x201C: "INVALID_DEVICE_PROP_VALUE",
    0x201E: "SESSION_ALREADY_OPEN",
}


def code_entry(code: int, names: dict[int, str] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "hex": f"0x{code:04X}",
        "name": (names or {}).get(code, f"UNKNOWN_0x{code:04X}"),
    }


class LabError(RuntimeError):
    """Base error carrying a stable, non-sensitive diagnostic code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class TransactionSequence:
    """Allocate each PTP transaction ID exactly once, including on failure."""

    next_id: int = 0

    def take(self) -> int:
        transaction_id = self.next_id
        self.next_id += 1
        return transaction_id


class PtpResponseError(LabError):
    def __init__(self, operation: int, transaction_id: int, response_code: int):
        name = RESPONSE_NAMES.get(response_code, f"PTP_0x{response_code:04X}")
        super().__init__(
            "PTP_RESPONSE",
            f"{OPERATION_NAMES.get(operation, f'0x{operation:04X}')} failed with {name} at transaction {transaction_id}.",
        )
        self.operation = operation
        self.transaction_id = transaction_id
        self.response_code = response_code


class DeviceDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bcdUSB", ctypes.c_uint16),
        ("bDeviceClass", ctypes.c_uint8),
        ("bDeviceSubClass", ctypes.c_uint8),
        ("bDeviceProtocol", ctypes.c_uint8),
        ("bMaxPacketSize0", ctypes.c_uint8),
        ("idVendor", ctypes.c_uint16),
        ("idProduct", ctypes.c_uint16),
        ("bcdDevice", ctypes.c_uint16),
        ("iManufacturer", ctypes.c_uint8),
        ("iProduct", ctypes.c_uint8),
        ("iSerialNumber", ctypes.c_uint8),
        ("bNumConfigurations", ctypes.c_uint8),
    ]


class EndpointDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bEndpointAddress", ctypes.c_uint8),
        ("bmAttributes", ctypes.c_uint8),
        ("wMaxPacketSize", ctypes.c_uint16),
        ("bInterval", ctypes.c_uint8),
        ("bRefresh", ctypes.c_uint8),
        ("bSynchAddress", ctypes.c_uint8),
        ("extra", ctypes.POINTER(ctypes.c_ubyte)),
        ("extra_length", ctypes.c_int),
    ]


class InterfaceDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("bInterfaceNumber", ctypes.c_uint8),
        ("bAlternateSetting", ctypes.c_uint8),
        ("bNumEndpoints", ctypes.c_uint8),
        ("bInterfaceClass", ctypes.c_uint8),
        ("bInterfaceSubClass", ctypes.c_uint8),
        ("bInterfaceProtocol", ctypes.c_uint8),
        ("iInterface", ctypes.c_uint8),
        ("endpoint", ctypes.POINTER(EndpointDescriptor)),
        ("extra", ctypes.POINTER(ctypes.c_ubyte)),
        ("extra_length", ctypes.c_int),
    ]


class Interface(ctypes.Structure):
    _fields_ = [
        ("altsetting", ctypes.POINTER(InterfaceDescriptor)),
        ("num_altsetting", ctypes.c_int),
    ]


class ConfigDescriptor(ctypes.Structure):
    _fields_ = [
        ("bLength", ctypes.c_uint8),
        ("bDescriptorType", ctypes.c_uint8),
        ("wTotalLength", ctypes.c_uint16),
        ("bNumInterfaces", ctypes.c_uint8),
        ("bConfigurationValue", ctypes.c_uint8),
        ("iConfiguration", ctypes.c_uint8),
        ("bmAttributes", ctypes.c_uint8),
        ("MaxPower", ctypes.c_uint8),
        ("interface", ctypes.POINTER(Interface)),
        ("extra", ctypes.POINTER(ctypes.c_ubyte)),
        ("extra_length", ctypes.c_int),
    ]


@dataclass
class PtpInterface:
    configuration: int
    number: int
    alternate: int
    interface_class: int
    subclass: int
    protocol: int
    bulk_in: int
    bulk_out: int
    bulk_in_packet_size: int
    bulk_out_packet_size: int
    event_in: int | None
    event_packet_size: int | None


class LibUsb:
    """Minimal libusb surface required by this non-mutating laboratory."""

    def __init__(self) -> None:
        path = ctypes.util.find_library("usb-1.0") or "libusb-1.0.so.0"
        self.api = ctypes.CDLL(path)
        self._declare()

    def _declare(self) -> None:
        api = self.api
        api.libusb_init.argtypes = [ctypes.POINTER(ctypes.c_void_p)]
        api.libusb_init.restype = ctypes.c_int
        api.libusb_exit.argtypes = [ctypes.c_void_p]
        api.libusb_get_device_list.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)),
        ]
        api.libusb_get_device_list.restype = ctypes.c_ssize_t
        api.libusb_free_device_list.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_int]
        api.libusb_get_device_descriptor.argtypes = [ctypes.c_void_p, ctypes.POINTER(DeviceDescriptor)]
        api.libusb_get_device_descriptor.restype = ctypes.c_int
        api.libusb_get_bus_number.argtypes = [ctypes.c_void_p]
        api.libusb_get_bus_number.restype = ctypes.c_uint8
        api.libusb_get_device_address.argtypes = [ctypes.c_void_p]
        api.libusb_get_device_address.restype = ctypes.c_uint8
        api.libusb_open.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
        api.libusb_open.restype = ctypes.c_int
        api.libusb_close.argtypes = [ctypes.c_void_p]
        api.libusb_get_active_config_descriptor.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.POINTER(ConfigDescriptor)),
        ]
        api.libusb_get_active_config_descriptor.restype = ctypes.c_int
        api.libusb_free_config_descriptor.argtypes = [ctypes.POINTER(ConfigDescriptor)]
        api.libusb_kernel_driver_active.argtypes = [ctypes.c_void_p, ctypes.c_int]
        api.libusb_kernel_driver_active.restype = ctypes.c_int
        api.libusb_claim_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
        api.libusb_claim_interface.restype = ctypes.c_int
        api.libusb_release_interface.argtypes = [ctypes.c_void_p, ctypes.c_int]
        api.libusb_release_interface.restype = ctypes.c_int
        api.libusb_set_interface_alt_setting.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
        api.libusb_set_interface_alt_setting.restype = ctypes.c_int
        api.libusb_get_string_descriptor_ascii.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint8,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
        ]
        api.libusb_get_string_descriptor_ascii.restype = ctypes.c_int
        api.libusb_bulk_transfer.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ubyte,
            ctypes.POINTER(ctypes.c_ubyte),
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_int),
            ctypes.c_uint,
        ]
        api.libusb_bulk_transfer.restype = ctypes.c_int
        api.libusb_error_name.argtypes = [ctypes.c_int]
        api.libusb_error_name.restype = ctypes.c_char_p

    def check(self, result: int, action: str) -> None:
        if result >= 0:
            return
        raw = self.api.libusb_error_name(result)
        name = raw.decode("ascii", "replace") if raw else f"LIBUSB_{result}"
        raise LabError("LIBUSB", f"{action} failed with {name} ({result}).")


class UsbPtpDevice:
    def __init__(self, usb: LibUsb) -> None:
        self.usb = usb
        self.context = ctypes.c_void_p()
        self.device = ctypes.c_void_p()
        self.handle = ctypes.c_void_p()
        self.interface: PtpInterface | None = None
        self.claimed = False
        self.receive_buffer = bytearray()
        self.ledger: list[dict[str, Any]] = []

    def __enter__(self) -> "UsbPtpDevice":
        self.usb.check(self.usb.api.libusb_init(ctypes.byref(self.context)), "libusb initialization")
        try:
            self._find_and_open()
            return self
        except Exception:
            self.close()
            raise

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        self.close()

    def _find_and_open(self) -> None:
        devices = ctypes.POINTER(ctypes.c_void_p)()
        count = self.usb.api.libusb_get_device_list(self.context, ctypes.byref(devices))
        self.usb.check(int(count), "USB device enumeration")
        found = None
        descriptor = DeviceDescriptor()
        try:
            for index in range(count):
                candidate = devices[index]
                current = DeviceDescriptor()
                if self.usb.api.libusb_get_device_descriptor(candidate, ctypes.byref(current)) != 0:
                    continue
                if current.idVendor == FUJI_VENDOR_ID and current.idProduct == X_E5_PRODUCT_ID:
                    if found is not None:
                        raise LabError("AMBIGUOUS_DEVICE", "More than one 04CB:0313 device is connected.")
                    found = candidate
                    descriptor = current
            if found is None:
                raise LabError("DEVICE_NOT_FOUND", "No Fujifilm X-E5 (04CB:0313) is connected.")
            self.device = found
            self.interface = self._inspect_interface(found)
            self.usb.check(self.usb.api.libusb_open(found, ctypes.byref(self.handle)), "USB device open")
        finally:
            # libusb_open retains its own reference; the device-list references
            # can be released without invalidating the open handle.
            self.usb.api.libusb_free_device_list(devices, 1)

        assert self.interface is not None
        driver = self.usb.api.libusb_kernel_driver_active(self.handle, self.interface.number)
        if driver == 1:
            raise LabError("KERNEL_DRIVER_ACTIVE", "A kernel driver owns the PTP interface; the laboratory will not detach it automatically.")
        self.usb.check(driver, "Kernel-driver status query")
        self.usb.check(
            self.usb.api.libusb_claim_interface(self.handle, self.interface.number),
            "PTP interface claim",
        )
        self.claimed = True
        if self.interface.alternate != 0:
            self.usb.check(
                self.usb.api.libusb_set_interface_alt_setting(
                    self.handle,
                    self.interface.number,
                    self.interface.alternate,
                ),
                "PTP alternate-setting selection",
            )
        self.descriptor = descriptor

    def _inspect_interface(self, device: ctypes.c_void_p) -> PtpInterface:
        config_pointer = ctypes.POINTER(ConfigDescriptor)()
        self.usb.check(
            self.usb.api.libusb_get_active_config_descriptor(device, ctypes.byref(config_pointer)),
            "Active USB configuration read",
        )
        matches: list[PtpInterface] = []
        try:
            config = config_pointer.contents
            for interface_index in range(config.bNumInterfaces):
                group = config.interface[interface_index]
                for alternate_index in range(group.num_altsetting):
                    alternate = group.altsetting[alternate_index]
                    if (
                        alternate.bInterfaceClass,
                        alternate.bInterfaceSubClass,
                        alternate.bInterfaceProtocol,
                    ) != (6, 1, 1):
                        continue
                    bulk_in = bulk_out = event_in = None
                    bulk_in_size = bulk_out_size = event_size = None
                    for endpoint_index in range(alternate.bNumEndpoints):
                        endpoint = alternate.endpoint[endpoint_index]
                        transfer_type = endpoint.bmAttributes & 0x03
                        incoming = bool(endpoint.bEndpointAddress & 0x80)
                        if transfer_type == 2 and incoming:
                            bulk_in = endpoint.bEndpointAddress
                            bulk_in_size = endpoint.wMaxPacketSize
                        elif transfer_type == 2 and not incoming:
                            bulk_out = endpoint.bEndpointAddress
                            bulk_out_size = endpoint.wMaxPacketSize
                        elif transfer_type == 3 and incoming:
                            event_in = endpoint.bEndpointAddress
                            event_size = endpoint.wMaxPacketSize
                    if bulk_in is not None and bulk_out is not None:
                        matches.append(PtpInterface(
                            configuration=config.bConfigurationValue,
                            number=alternate.bInterfaceNumber,
                            alternate=alternate.bAlternateSetting,
                            interface_class=alternate.bInterfaceClass,
                            subclass=alternate.bInterfaceSubClass,
                            protocol=alternate.bInterfaceProtocol,
                            bulk_in=bulk_in,
                            bulk_out=bulk_out,
                            bulk_in_packet_size=int(bulk_in_size or 0),
                            bulk_out_packet_size=int(bulk_out_size or 0),
                            event_in=event_in,
                            event_packet_size=int(event_size) if event_size is not None else None,
                        ))
        finally:
            self.usb.api.libusb_free_config_descriptor(config_pointer)
        if len(matches) != 1:
            raise LabError("PTP_INTERFACE", f"Expected one exact 06/01/01 PTP interface; found {len(matches)}.")
        return matches[0]

    def close(self) -> None:
        if self.handle:
            if self.claimed and self.interface is not None:
                self.usb.api.libusb_release_interface(self.handle, self.interface.number)
            self.claimed = False
            self.usb.api.libusb_close(self.handle)
            self.handle = ctypes.c_void_p()
        if self.context:
            self.usb.api.libusb_exit(self.context)
            self.context = ctypes.c_void_p()

    def safe_usb_diagnostics(self) -> dict[str, Any]:
        assert self.interface is not None
        return {
            "vendorId": self.descriptor.idVendor,
            "vendorIdHex": f"0x{self.descriptor.idVendor:04X}",
            "productId": self.descriptor.idProduct,
            "productIdHex": f"0x{self.descriptor.idProduct:04X}",
            "manufacturer": self._safe_string(self.descriptor.iManufacturer),
            "product": self._safe_string(self.descriptor.iProduct),
            "serial": "[NOT REQUESTED]",
            "configuration": self.interface.configuration,
            "interfaceNumber": self.interface.number,
            "alternateSetting": self.interface.alternate,
            "class": self.interface.interface_class,
            "subclass": self.interface.subclass,
            "protocol": self.interface.protocol,
            "bulkIn": self._endpoint(self.interface.bulk_in, self.interface.bulk_in_packet_size, "bulk"),
            "bulkOut": self._endpoint(self.interface.bulk_out, self.interface.bulk_out_packet_size, "bulk"),
            "eventIn": self._endpoint(self.interface.event_in, self.interface.event_packet_size, "interrupt") if self.interface.event_in is not None else None,
        }

    def _safe_string(self, index: int) -> str | None:
        if index == 0:
            return None
        data = (ctypes.c_ubyte * 256)()
        length = self.usb.api.libusb_get_string_descriptor_ascii(self.handle, index, data, len(data))
        if length < 0:
            return None
        return bytes(data[:length]).decode("utf-8", "replace")

    @staticmethod
    def _endpoint(address: int | None, size: int | None, transfer_type: str) -> dict[str, Any]:
        assert address is not None
        return {
            "address": f"0x{address:02X}",
            "number": address & 0x0F,
            "direction": "in" if address & 0x80 else "out",
            "type": transfer_type,
            "packetSize": size,
        }

    def transact(self, operation: int, transaction_id: int, params: list[int], expect_data: bool) -> bytes | None:
        if operation not in {
            OPEN_SESSION,
            GET_DEVICE_INFO,
            CLOSE_SESSION,
            GET_OBJECT_INFO,
            GET_OBJECT,
            GET_DEVICE_PROP_DESC,
            GET_DEVICE_PROP_VALUE,
        }:
            raise LabError("POLICY_DENIED", f"Operation 0x{operation:04X} is not enabled in the read-only CLI.")
        if operation in {GET_OBJECT_INFO, GET_OBJECT} and params != [BACKUP_HANDLE]:
            raise LabError("POLICY_DENIED", "Backup object reads are restricted to exact handle 0.")
        command = struct.pack("<IHHI", 12 + 4 * len(params), PTP_COMMAND, operation, transaction_id)
        command += b"".join(struct.pack("<I", value) for value in params)
        evidence = {
            "sequence": len(self.ledger) + 1,
            "transactionId": transaction_id,
            "operation": code_entry(operation, OPERATION_NAMES),
            "commandLength": len(command),
            "parameterCount": len(params),
            "dataPhaseReceived": False,
            "response": None,
            "status": "IN_PROGRESS",
        }
        self.ledger.append(evidence)
        self._bulk_write(command)
        payload = None
        if expect_data:
            kind, code, received_transaction, body = self._read_container()
            if kind == PTP_RESPONSE:
                response_code = code
                response_params = body
                self._validate_container(kind, PTP_RESPONSE, response_code, None, received_transaction, transaction_id)
                evidence["response"] = code_entry(response_code, RESPONSE_NAMES)
                evidence["responseParameterCount"] = len(response_params) // 4
                evidence["status"] = "PTP_RESPONSE"
                raise PtpResponseError(operation, transaction_id, response_code)
            self._validate_container(kind, PTP_DATA, code, operation, received_transaction, transaction_id)
            payload = body
            evidence["dataPhaseReceived"] = True
        kind, response_code, received_transaction, response_params = self._read_container()
        self._validate_container(kind, PTP_RESPONSE, response_code, None, received_transaction, transaction_id)
        evidence["response"] = code_entry(response_code, RESPONSE_NAMES)
        evidence["responseParameterCount"] = len(response_params) // 4
        evidence["status"] = "OK" if response_code == PTP_OK else "PTP_RESPONSE"
        if response_code != PTP_OK:
            raise PtpResponseError(operation, transaction_id, response_code)
        return payload

    def set_recipe_selector(self, transaction_id: int, payload: bytes) -> None:
        """The CLI's sole data-out path: exact uint16 D18C values 1 through 7."""

        if len(payload) != 2:
            raise LabError("POLICY_DENIED", "Recipe selector writes require an exact two-byte payload.")
        target = int.from_bytes(payload, "little", signed=False)
        if target not in range(1, 8):
            raise LabError("POLICY_DENIED", "Recipe selector writes are restricted to C1 through C7.")
        params = [0xD18C]
        command = struct.pack(
            "<IHHII",
            16,
            PTP_COMMAND,
            SET_DEVICE_PROP_VALUE,
            transaction_id,
            params[0],
        )
        data = struct.pack(
            "<IHHI",
            12 + len(payload),
            PTP_DATA,
            SET_DEVICE_PROP_VALUE,
            transaction_id,
        ) + payload
        evidence = {
            "sequence": len(self.ledger) + 1,
            "transactionId": transaction_id,
            "operation": code_entry(SET_DEVICE_PROP_VALUE, OPERATION_NAMES),
            "commandLength": len(command),
            "parameterCount": 1,
            "dataPhaseSent": True,
            "dataPayloadWidth": len(payload),
            "selectorTarget": target,
            "response": None,
            "status": "IN_PROGRESS",
        }
        self.ledger.append(evidence)
        self._bulk_write(command)
        self._bulk_write(data)
        kind, response_code, received_transaction, response_params = self._read_container()
        self._validate_container(kind, PTP_RESPONSE, response_code, None, received_transaction, transaction_id)
        evidence["response"] = code_entry(response_code, RESPONSE_NAMES)
        evidence["responseParameterCount"] = len(response_params) // 4
        evidence["status"] = "OK" if response_code == PTP_OK else "PTP_RESPONSE"
        if response_code != PTP_OK:
            raise PtpResponseError(SET_DEVICE_PROP_VALUE, transaction_id, response_code)

    def _bulk_write(self, data: bytes) -> None:
        assert self.interface is not None
        buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        transferred = ctypes.c_int()
        result = self.usb.api.libusb_bulk_transfer(
            self.handle,
            self.interface.bulk_out,
            buffer,
            len(data),
            ctypes.byref(transferred),
            USB_TIMEOUT_MS,
        )
        self.usb.check(result, "USB Bulk OUT")
        if transferred.value != len(data):
            raise LabError("SHORT_WRITE", f"USB Bulk OUT transferred {transferred.value} of {len(data)} bytes.")

    def _read_container(self) -> tuple[int, int, int, bytes]:
        while len(self.receive_buffer) < 12:
            self.receive_buffer.extend(self._bulk_read())
        declared_length = struct.unpack_from("<I", self.receive_buffer, 0)[0]
        if declared_length < 12 or declared_length > MAX_CONTAINER_SIZE:
            raise LabError("INVALID_CONTAINER_LENGTH", f"PTP container declares invalid length {declared_length}.")
        while len(self.receive_buffer) < declared_length:
            self.receive_buffer.extend(self._bulk_read())
        container = bytes(self.receive_buffer[:declared_length])
        del self.receive_buffer[:declared_length]
        _length, kind, code, transaction_id = struct.unpack_from("<IHHI", container, 0)
        return kind, code, transaction_id, container[12:]

    def _bulk_read(self) -> bytes:
        assert self.interface is not None
        size = max(16 * 1024, self.interface.bulk_in_packet_size)
        buffer = (ctypes.c_ubyte * size)()
        transferred = ctypes.c_int()
        result = self.usb.api.libusb_bulk_transfer(
            self.handle,
            self.interface.bulk_in,
            buffer,
            size,
            ctypes.byref(transferred),
            USB_TIMEOUT_MS,
        )
        self.usb.check(result, "USB Bulk IN")
        if transferred.value <= 0:
            raise LabError("EMPTY_READ", "USB Bulk IN returned no bytes.")
        return bytes(buffer[:transferred.value])

    @staticmethod
    def _validate_container(
        actual_kind: int,
        expected_kind: int,
        actual_code: int,
        expected_code: int | None,
        actual_transaction: int,
        expected_transaction: int,
    ) -> None:
        if actual_kind != expected_kind:
            raise LabError("CONTAINER_TYPE", f"Expected PTP container type {expected_kind}; received {actual_kind}.")
        if expected_code is not None and actual_code != expected_code:
            raise LabError("CONTAINER_CODE", f"Expected PTP code 0x{expected_code:04X}; received 0x{actual_code:04X}.")
        if actual_transaction != expected_transaction:
            raise LabError("TRANSACTION_MISMATCH", f"Expected transaction {expected_transaction}; received {actual_transaction}.")


class DatasetReader:
    def __init__(self, data: bytes):
        self.data = data
        self.offset = 0

    def take(self, count: int) -> bytes:
        end = self.offset + count
        if end > len(self.data):
            raise LabError("SHORT_DATASET", f"PTP dataset ended at byte {len(self.data)} while reading through byte {end}.")
        result = self.data[self.offset:end]
        self.offset = end
        return result

    def u16(self) -> int:
        return struct.unpack("<H", self.take(2))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def u16_array(self) -> list[int]:
        count = self.u32()
        return [self.u16() for _ in range(count)]

    def ptp_string(self, redact: bool = False) -> str:
        count = self.take(1)[0]
        if count == 0:
            return ""
        raw = self.take(count * 2)
        if raw[-2:] != b"\x00\x00":
            raise LabError("MALFORMED_PTP_STRING", "PTP string is missing its UTF-16LE terminator.")
        decoded = raw[:-2].decode("utf-16le", "strict")
        if "\x00" in decoded:
            raise LabError("MALFORMED_PTP_STRING", "PTP string contains an embedded NUL.")
        if redact:
            return "[REDACTED]"
        return decoded


def parse_device_info(payload: bytes) -> dict[str, Any]:
    reader = DatasetReader(payload)
    standard_version = reader.u16()
    vendor_extension_id = reader.u32()
    vendor_extension_version = reader.u16()
    vendor_extension_description = reader.ptp_string()
    functional_mode = reader.u16()
    operations = reader.u16_array()
    events = reader.u16_array()
    properties = reader.u16_array()
    capture_formats = reader.u16_array()
    image_formats = reader.u16_array()
    manufacturer = reader.ptp_string()
    model = reader.ptp_string()
    device_version = reader.ptp_string()
    redacted_serial = reader.ptp_string(redact=True)
    if reader.offset != len(payload):
        raise LabError("TRAILING_DATASET_BYTES", f"DeviceInfo has {len(payload) - reader.offset} unparsed trailing bytes.")
    return {
        "standardVersion": standard_version,
        "vendorExtensionId": vendor_extension_id,
        "vendorExtensionIdHex": f"0x{vendor_extension_id:08X}",
        "vendorExtensionVersion": vendor_extension_version,
        "vendorExtensionDescription": vendor_extension_description,
        "functionalMode": functional_mode,
        "operations": [code_entry(value, OPERATION_NAMES) for value in operations],
        "events": [code_entry(value, EVENT_NAMES) for value in events],
        "properties": [code_entry(value, PROPERTY_NAMES) for value in properties],
        "captureFormats": [code_entry(value) for value in capture_formats],
        "imageFormats": [code_entry(value) for value in image_formats],
        "manufacturer": manufacturer,
        "model": model,
        "normalizedModel": "XE5" if "".join(ch for ch in model.upper() if ch.isalnum()).endswith("XE5") else "UNKNOWN",
        "deviceVersion": device_version,
        "serial": redacted_serial,
        "serialPresent": redacted_serial == "[REDACTED]",
        "payloadLength": len(payload),
        "recipeSelectorAdvertised": 0xD18C in properties,
    }


def parse_object_info(payload: bytes) -> dict[str, Any]:
    """Parse ObjectInfo while redacting every free-text field at ingestion."""

    reader = DatasetReader(payload)
    result = {
        "storageId": reader.u32(),
        "objectFormat": reader.u16(),
        "protectionStatus": reader.u16(),
        "objectCompressedSize": reader.u32(),
        "thumbFormat": reader.u16(),
        "thumbCompressedSize": reader.u32(),
        "thumbPixWidth": reader.u32(),
        "thumbPixHeight": reader.u32(),
        "imagePixWidth": reader.u32(),
        "imagePixHeight": reader.u32(),
        "imageBitDepth": reader.u32(),
        "parentObject": reader.u32(),
        "associationType": reader.u16(),
        "associationDescription": reader.u32(),
        "sequenceNumber": reader.u32(),
        "filename": reader.ptp_string(redact=True),
        "captureDate": reader.ptp_string(redact=True),
        "modificationDate": reader.ptp_string(redact=True),
        "keywords": reader.ptp_string(redact=True),
    }
    if reader.offset != len(payload):
        raise LabError("TRAILING_DATASET_BYTES", f"ObjectInfo has {len(payload) - reader.offset} unparsed trailing bytes.")
    result["datasetWidth"] = len(payload)
    return result


FS_FIELDS = {
    "filmSimulation": (1991, 3, 1),
    "whiteBalanceKelvin": (34704, 2, 2),
    "whiteBalanceMode": (34716, 1, 1),
    "highIsoNr": (34722, 1, 1),
    "clarity": (34728, 1, 1),
    "monoWarmCool": (34731, 1, 1),
    "monoMagentaGreen": (34737, 1, 1),
    "dynamicRange": (34743, 1, 1),
    "color": (34752, 1, 1),
    "sharpness": (34758, 1, 1),
    "highlight": (34764, 1, 1),
    "shadow": (34770, 1, 1),
    "colorChrome": (34776, 1, 1),
    "colorChromeBlue": (34779, 1, 1),
    "grainStrength": (34782, 1, 1),
    "grainSize": (34785, 1, 1),
    "smoothSkin": (34788, 1, 1),
    "wbShiftR": (34864, 1, 1),
    "wbShiftB": (34870, 1, 1),
}

FS_FILM_SIMULATIONS = {
    0x01: "Provia", 0x04: "Velvia", 0x02: "Astia", 0x0E: "ProNegHi",
    0x0D: "ProNegStd", 0x09: "Monochrome", 0x0B: "MonochromeY",
    0x0A: "MonochromeR", 0x0C: "MonochromeG", 0x06: "Sepia",
    0x0F: "ClassicChrome", 0x16: "Acros", 0x18: "AcrosY", 0x17: "AcrosR",
    0x19: "AcrosG", 0x13: "Eterna", 0x10: "ClassicNeg",
    0x14: "EternaBleach", 0x11: "NostalgicNeg", 0x12: "RealaAce",
}

FS_WHITE_BALANCE = {
    0x00: "Auto", 0x01: "AutoWhitePriority", 0x02: "AutoAmbiencePriority",
    0x03: "Daylight", 0x04: "Shade", 0x05: "Fluorescent1",
    0x06: "Fluorescent2", 0x07: "Fluorescent3", 0x08: "Incandescent",
    0x09: "Underwater", 0x0A: "Temperature", 0x0B: "Custom1",
    0x0C: "Custom2", 0x0D: "Custom3",
}

MONO_FILMS = {
    "Monochrome", "MonochromeY", "MonochromeR", "MonochromeG",
    "Acros", "AcrosY", "AcrosR", "AcrosG",
}
COLOR_LOCKED_FILMS = MONO_FILMS | {"Sepia"}


def model_from_backup(blob: bytes) -> str | None:
    if len(blob) < 0x34 or blob[:8] != b"FUJIFILM":
        return None
    raw = blob[0x14:0x34].split(b"\x00", 1)[0]
    try:
        return raw.decode("ascii", "strict").strip() or None
    except UnicodeDecodeError:
        return None


def normalize_model(model: str | None) -> str:
    source = (model or "").upper().replace("FUJIFILM", "")
    return "".join(character for character in source if character.isalnum())


def decode_fs_slots(blob: bytes) -> list[dict[str, Any]]:
    """Decode only the published X-E5 FS field layout after hard model/size gates."""

    backup_model = model_from_backup(blob)
    if normalize_model(backup_model) != "XE5" or len(blob) != X_E5_BACKUP_SIZE:
        raise LabError("FS_DECODE_GATE", "FS decoding requires an exact-size backup whose embedded model normalizes to XE5.")

    slots = []
    for slot in range(3):
        raw: dict[str, int] = {}
        properties = []
        for key, (base, step, width) in FS_FIELDS.items():
            offset = base + slot * step
            field_bytes = blob[offset:offset + width]
            if len(field_bytes) != width:
                raise LabError("FS_FIELD_BOUNDS", f"FS{slot + 1} field {key} is outside the guarded backup.")
            raw[key] = int.from_bytes(field_bytes, "little", signed=False)
            properties.append({
                "key": key,
                "offset": offset,
                "payloadWidth": width,
                "rawValue": raw[key],
                "evidenceLevel": "PUBLIC_RESEARCH_APPLIED_TO_PHYSICAL_X_E5_BACKUP",
            })

        film = FS_FILM_SIMULATIONS.get(raw["filmSimulation"])
        white_balance = FS_WHITE_BALANCE.get(raw["whiteBalanceMode"])
        decoded_values = {
            "filmSimulation": film,
            "dynamicRange": {0: "Auto", 1: "DR100", 2: "DR200", 3: "DR400"}.get(raw["dynamicRange"]),
            "dRangePriority": None,
            "grainStrength": {0: "Strong", 1: "Weak", 2: "Off"}.get(raw["grainStrength"]),
            "grainSize": {0: "Small", 1: "Large"}.get(raw["grainSize"]),
            "colorChrome": {0: "Off", 1: "Weak", 2: "Strong"}.get(raw["colorChrome"]),
            "colorChromeBlue": {0: "Off", 1: "Weak", 2: "Strong"}.get(raw["colorChromeBlue"]),
            "smoothSkin": {0: "Off", 1: "Weak", 2: "Strong"}.get(raw["smoothSkin"]),
            "whiteBalanceMode": white_balance,
            "whiteBalanceKelvin": raw["whiteBalanceKelvin"] if white_balance == "Temperature" and 2500 <= raw["whiteBalanceKelvin"] <= 10000 and raw["whiteBalanceKelvin"] % 10 == 0 else None,
            "wbShiftR": 9 - raw["wbShiftR"] if 0 <= raw["wbShiftR"] <= 18 else None,
            "wbShiftB": 9 - raw["wbShiftB"] if 0 <= raw["wbShiftB"] <= 18 else None,
            "highlight": raw["highlight"] / 2 - 2 if 0 <= raw["highlight"] <= 12 else None,
            "shadow": raw["shadow"] / 2 - 2 if 0 <= raw["shadow"] <= 12 else None,
            "color": 7 - raw["color"] if film is not None and film not in COLOR_LOCKED_FILMS and 3 <= raw["color"] <= 11 else None,
            "sharpness": 4 - raw["sharpness"] if 0 <= raw["sharpness"] <= 8 else None,
            "highIsoNr": raw["highIsoNr"] - 4 if 0 <= raw["highIsoNr"] <= 8 else None,
            "clarity": raw["clarity"] - 6 if 1 <= raw["clarity"] <= 11 else None,
            "monoWarmCool": 18 - raw["monoWarmCool"] if film in MONO_FILMS and 0 <= raw["monoWarmCool"] <= 36 else None,
            "monoMagentaGreen": 18 - raw["monoMagentaGreen"] if film in MONO_FILMS and 0 <= raw["monoMagentaGreen"] <= 36 else None,
        }
        physical_target = FS_PHYSICAL_TARGETS.get(slot)
        if physical_target is not None:
            target_raw, target_values, _target_source = physical_target
            for key, canonical in target_values.items():
                if raw.get(key) == target_raw.get(key):
                    decoded_values[key] = canonical
        for property_entry in properties:
            canonical = decoded_values.get(property_entry["key"])
            property_entry["canonicalValue"] = canonical
            property_entry["readStatus"] = "OK" if canonical is not None else "PASSTHROUGH_OR_NOT_APPLICABLE"
            if physical_target is not None and physical_target[0].get(property_entry["key"]) == property_entry["rawValue"]:
                property_entry["evidenceLevel"] = "PHYSICAL_X_E5_FW_1_10"
                property_entry["researchSource"] = physical_target[2]
        enabled_offset = FS_RECIPE_ENABLED_OFFSETS.get(slot)
        if enabled_offset is not None:
            enabled_raw = blob[enabled_offset]
            enabled_status = {0: "OFF", 1: "ON"}.get(enabled_raw, "UNKNOWN_FROM_BACKUP")
            properties.insert(0, {
                "key": "fsRecipeEnabled",
                "offset": enabled_offset,
                "payloadWidth": 1,
                "rawValue": enabled_raw,
                "canonicalValue": enabled_status if enabled_status != "UNKNOWN_FROM_BACKUP" else None,
                "readStatus": "OK" if enabled_status != "UNKNOWN_FROM_BACKUP" else "PASSTHROUGH",
                "evidenceLevel": "PHYSICAL_X_E5_FW_1_10",
                "researchSource": f"Bidirectional owner-menu FS{slot + 1} toggle and volatile backup comparison on 2026-08-03.",
            })
        else:
            enabled_status = "UNKNOWN_FROM_BACKUP"
        values = dict(decoded_values) if enabled_status != "OFF" else {
            key: value if key == "filmSimulation" else None
            for key, value in decoded_values.items()
        }
        slots.append({
            "id": f"FS{slot + 1}",
            "values": values,
            "decodedValues": decoded_values,
            "fsRecipeStatus": enabled_status,
            "valuesActive": True if enabled_status == "ON" else False if enabled_status == "OFF" else None,
            "properties": properties,
            "evidenceLevel": "PUBLIC_RESEARCH_APPLIED_TO_PHYSICAL_X_E5_BACKUP",
            "uncertainty": "The X-E5 model/size gates are physical evidence; FS offsets and enum mappings still require comparison with the owner\'s menus.",
        })
    return slots


DATA_TYPE_NAMES = {
    0x0001: "INT8",
    0x0002: "UINT8",
    0x0003: "INT16",
    0x0004: "UINT16",
    0x0005: "INT32",
    0x0006: "UINT32",
    0x0007: "INT64",
    0x0008: "UINT64",
    0x0009: "INT128",
    0x000A: "UINT128",
    0xFFFF: "STRING",
}

SCALAR_WIDTHS = {
    0x0001: 1,
    0x0002: 1,
    0x0003: 2,
    0x0004: 2,
    0x0005: 4,
    0x0006: 4,
    0x0007: 8,
    0x0008: 8,
    0x0009: 16,
    0x000A: 16,
}


def take_typed_value(reader: DatasetReader, data_type: int, expose: bool) -> dict[str, Any]:
    start = reader.offset
    value: int | str | None = None
    if data_type == 0xFFFF:
        count = reader.take(1)[0]
        reader.take(count * 2)
    elif data_type & 0x4000:
        element_type = data_type & ~0x4000
        width = SCALAR_WIDTHS.get(element_type)
        if width is None:
            raise LabError("UNKNOWN_DATA_TYPE", f"Unsupported PTP array element type 0x{element_type:04X}.")
        count = reader.u32()
        reader.take(count * width)
    else:
        width = SCALAR_WIDTHS.get(data_type)
        if width is None:
            raise LabError("UNKNOWN_DATA_TYPE", f"Unsupported PTP data type 0x{data_type:04X}.")
        raw = reader.take(width)
        if expose and width <= 8:
            signed = data_type in {0x0001, 0x0003, 0x0005, 0x0007}
            value = int.from_bytes(raw, "little", signed=signed)
    result = {
        "width": reader.offset - start,
        "value": value if expose and value is not None else "[REDACTED]",
    }
    return result


def parse_property_descriptor(payload: bytes, expected_code: int) -> dict[str, Any]:
    reader = DatasetReader(payload)
    property_code = reader.u16()
    if property_code != expected_code:
        raise LabError(
            "PROPERTY_DESCRIPTOR_MISMATCH",
            f"Requested property 0x{expected_code:04X}; descriptor reports 0x{property_code:04X}.",
        )
    data_type = reader.u16()
    get_set = reader.take(1)[0]
    # Only standard, non-identifier numeric properties are safe to expose.
    expose_values = property_code in {0x5001, 0xD407}
    default_value = take_typed_value(reader, data_type, expose_values)
    current_value = take_typed_value(reader, data_type, expose_values)
    form_flag = reader.take(1)[0]
    form_payload_width = len(payload) - reader.offset
    return {
        "property": code_entry(property_code, PROPERTY_NAMES),
        "dataType": {
            "code": data_type,
            "hex": f"0x{data_type:04X}",
            "name": DATA_TYPE_NAMES.get(data_type, f"UNKNOWN_0x{data_type:04X}"),
        },
        "access": "GET_SET" if get_set else "GET_ONLY",
        "default": default_value,
        "current": current_value,
        "formFlag": form_flag,
        "formPayloadWidth": form_payload_width,
        "datasetWidth": len(payload),
        "unknownOrIdentifierValuesRedacted": not expose_values,
    }


def rejected_property_descriptor(property_code: int, error: PtpResponseError) -> dict[str, Any]:
    """Preserve a symbolic per-property response without ending the read pass."""

    return {
        "property": code_entry(property_code, PROPERTY_NAMES),
        "status": "PTP_RESPONSE",
        "response": code_entry(error.response_code, RESPONSE_NAMES),
        "transactionId": error.transaction_id,
        "datasetWidth": 0,
        "unknownOrIdentifierValuesRedacted": True,
    }


def discover() -> dict[str, Any]:
    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        session_open = False
        transactions = TransactionSequence()
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert payload is not None
            device_info = parse_device_info(payload)
            device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
            session_open = False
            return {
                "stage": "CLI_DISCOVERY_ONLY",
                "readOnly": True,
                "policy": "OpenSession, GetDeviceInfo, and CloseSession only",
                "usb": usb,
                "deviceInfo": device_info,
                "transactions": device.ledger,
                "sessionClosed": True,
                "interfaceRelease": "confirmed by process cleanup",
            }
        finally:
            if session_open:
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                except Exception:
                    # Do not mask the original error. __exit__ still releases
                    # the interface and closes the USB handle.
                    pass


def inspect_advertised_properties() -> dict[str, Any]:
    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        session_open = False
        transactions = TransactionSequence()
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            info_payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert info_payload is not None
            device_info = parse_device_info(info_payload)
            if device_info["normalizedModel"] != "XE5":
                raise LabError("MODEL_GATE", "Advertised-property inspection is locked to normalized model XE5.")
            descriptors = []
            for property_entry in device_info["properties"]:
                property_code = int(property_entry["code"])
                try:
                    descriptor_payload = device.transact(
                        GET_DEVICE_PROP_DESC,
                        transactions.take(),
                        [property_code],
                        expect_data=True,
                    )
                    assert descriptor_payload is not None
                    descriptor = parse_property_descriptor(descriptor_payload, property_code)
                    descriptor["status"] = "OK"
                    descriptors.append(descriptor)
                except PtpResponseError as error:
                    descriptors.append(rejected_property_descriptor(property_code, error))
            device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
            session_open = False
            return {
                "stage": "CLI_ADVERTISED_PROPERTY_DESCRIPTORS",
                "readOnly": True,
                "policy": "GetDevicePropDesc only for property codes returned by the same session's DeviceInfo",
                "usb": usb,
                "model": device_info["model"],
                "normalizedModel": device_info["normalizedModel"],
                "recipeSelectorAdvertised": device_info["recipeSelectorAdvertised"],
                "descriptors": descriptors,
                "transactions": device.ledger,
                "sessionClosed": True,
                "interfaceRelease": "confirmed by process cleanup",
            }
        finally:
            if session_open:
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                except Exception:
                    pass


def decode_fuji_usb_mode(payload: bytes) -> dict[str, Any]:
    if len(payload) not in {1, 2, 4}:
        return {
            "rawHex": payload.hex(" ").upper(),
            "payloadWidth": len(payload),
            "rawValue": None,
            "canonical": None,
            "status": "PASSTHROUGH_UNEXPECTED_WIDTH",
            "uncertainty": "libfuji documents the property values but not this payload width.",
        }
    raw_value = int.from_bytes(payload, "little", signed=False)
    canonical = FUJI_USB_MODE_NAMES.get(raw_value)
    return {
        "rawHex": payload.hex(" ").upper(),
        "payloadWidth": len(payload),
        "rawValue": raw_value,
        "canonical": canonical,
        "status": "DECODED_PUBLIC_MAPPING" if canonical else "PASSTHROUGH_UNKNOWN_VALUE",
        "uncertainty": (
            "Mapping is public libfuji research; the raw value and width are the physical X-E5 observation."
            if canonical
            else "This value is not mapped by the reviewed libfuji source."
        ),
    }


def inspect_fuji_usb_mode() -> dict[str, Any]:
    """Read only Fujifilm USBMode (0xD16E), as used by libfuji setup."""

    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        session_open = False
        transactions = TransactionSequence()
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            info_payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert info_payload is not None
            device_info = parse_device_info(info_payload)
            if device_info["normalizedModel"] != "XE5":
                raise LabError("MODEL_GATE", "USB-mode inspection is locked to normalized model XE5.")
            if GET_DEVICE_PROP_VALUE not in {int(entry["code"]) for entry in device_info["operations"]}:
                raise LabError("OPERATION_GATE", "The camera did not advertise GetDevicePropValue.")
            mode_error = None
            try:
                mode_payload = device.transact(
                    GET_DEVICE_PROP_VALUE,
                    transactions.take(),
                    [FUJI_USB_MODE],
                    expect_data=True,
                )
                assert mode_payload is not None
                usb_mode = decode_fuji_usb_mode(mode_payload)
            except PtpResponseError as error:
                mode_error = {
                    "operation": code_entry(error.operation, OPERATION_NAMES),
                    "transactionId": error.transaction_id,
                    "response": code_entry(error.response_code, RESPONSE_NAMES),
                }
                usb_mode = {
                    "rawHex": "",
                    "payloadWidth": 0,
                    "rawValue": None,
                    "canonical": None,
                    "status": "PTP_RESPONSE_NO_DATA",
                    "uncertainty": "The camera rejected the read; no property value was inferred.",
                }
            device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
            session_open = False
            return {
                "stage": "CLI_FUJI_USB_MODE_READ",
                "readOnly": True,
                "policy": "GetDevicePropValue is restricted to Fujifilm USBMode 0xD16E",
                "researchBasis": "petabyt/libfuji fujiusb_setup",
                "usb": usb,
                "model": device_info["model"],
                "normalizedModel": device_info["normalizedModel"],
                "propertyAdvertised": FUJI_USB_MODE in {
                    int(entry["code"]) for entry in device_info["properties"]
                },
                "usbMode": usb_mode,
                "readError": mode_error,
                "transactions": device.ledger,
                "sessionClosed": True,
                "interfaceRelease": "confirmed by process cleanup",
            }
        finally:
            if session_open:
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                except Exception:
                    pass


RECIPE_SIGNED_PROPERTIES = {
    0xD193,
    0xD194,
    0xD19A,
    0xD19B,
    0xD19D,
    0xD19E,
    0xD19F,
    0xD1A0,
    0xD1A2,
}
RECIPE_PASSTHROUGH_PROPERTIES = {0xD18E, 0xD18F, 0xD1A3, 0xD1A4, 0xD1A5}


def describe_recipe_payload(property_code: int, payload: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "property": code_entry(property_code, PROPERTY_NAMES),
        "rawHex": payload.hex(" ").upper(),
        "payloadWidth": len(payload),
        "rawValue": None,
        "readStatus": "OK",
        "normalization": None,
        "uncertainty": None,
    }
    if property_code == 0xD18D:
        try:
            reader = DatasetReader(payload)
            value = reader.ptp_string()
            if reader.offset != len(payload):
                raise LabError("TRAILING_STRING_BYTES", "PTP string has trailing bytes.")
            result["rawValue"] = value
            result["canonical"] = value
        except Exception as error:
            result["readStatus"] = "MALFORMED_PAYLOAD"
            result["uncertainty"] = str(error)
        return result
    if property_code in RECIPE_PASSTHROUGH_PROPERTIES:
        result["rawValue"] = result["rawHex"]
        result["canonical"] = None
        result["uncertainty"] = "No verified project mapping; preserved as hexadecimal passthrough data."
        return result
    if len(payload) != 2:
        result["readStatus"] = "UNEXPECTED_WIDTH"
        result["canonical"] = None
        result["uncertainty"] = "Known project mapping expects two bytes; no numeric decode was attempted."
        return result
    signed = property_code in RECIPE_SIGNED_PROPERTIES
    result["rawValue"] = int.from_bytes(payload, "little", signed=signed)
    result["rawUnsigned"] = int.from_bytes(payload, "little", signed=False)
    result["canonical"] = None
    result["uncertainty"] = "Canonical decoding is delegated to the maintained JavaScript X-E5 codec."
    return result


def read_current_recipe_slot() -> dict[str, Any]:
    """Read the selected recipe slot without moving the D18C selector."""

    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        session_open = False
        transactions = TransactionSequence()
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            info_payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert info_payload is not None
            device_info = parse_device_info(info_payload)
            advertised = {int(entry["code"]) for entry in device_info["properties"]}
            operations = {int(entry["code"]) for entry in device_info["operations"]}
            if device_info["normalizedModel"] != "XE5":
                raise LabError("MODEL_GATE", "Current-slot inspection is locked to normalized model XE5.")
            if 0xD18C not in advertised:
                raise LabError("SELECTOR_GATE", "DeviceInfo did not advertise recipe selector 0xD18C.")
            if GET_DEVICE_PROP_VALUE not in operations:
                raise LabError("OPERATION_GATE", "The camera did not advertise GetDevicePropValue.")

            selector_payload = device.transact(
                GET_DEVICE_PROP_VALUE,
                transactions.take(),
                [0xD18C],
                expect_data=True,
            )
            assert selector_payload is not None
            selector = describe_recipe_payload(0xD18C, selector_payload)
            selected_slot = selector.get("rawValue") if len(selector_payload) == 2 else None
            if selected_slot not in range(1, 8):
                raise LabError("SELECTOR_VALUE", "Recipe selector was not an exact uint16 value from 1 through 7.")

            properties = []
            for property_code in range(0xD18D, 0xD1A6):
                if property_code not in advertised:
                    properties.append({
                        "property": code_entry(property_code, PROPERTY_NAMES),
                        "rawHex": "",
                        "payloadWidth": 0,
                        "rawValue": None,
                        "canonical": None,
                        "readStatus": "NOT_ADVERTISED",
                        "normalization": None,
                        "uncertainty": "The same-session DeviceInfo did not advertise this property.",
                    })
                    continue
                try:
                    property_payload = device.transact(
                        GET_DEVICE_PROP_VALUE,
                        transactions.take(),
                        [property_code],
                        expect_data=True,
                    )
                    assert property_payload is not None
                    properties.append(describe_recipe_payload(property_code, property_payload))
                except PtpResponseError as error:
                    properties.append({
                        "property": code_entry(property_code, PROPERTY_NAMES),
                        "rawHex": "",
                        "payloadWidth": 0,
                        "rawValue": None,
                        "canonical": None,
                        "readStatus": "PTP_RESPONSE",
                        "response": code_entry(error.response_code, RESPONSE_NAMES),
                        "normalization": None,
                        "uncertainty": "The camera returned no property payload; no value was inferred.",
                    })

            device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
            session_open = False
            return {
                "stage": "CLI_CURRENT_RECIPE_SLOT_READ",
                "readOnly": True,
                "policy": "GetDevicePropValue is restricted to advertised 0xD18C-0xD1A5; selector is never written",
                "usb": usb,
                "model": device_info["model"],
                "normalizedModel": device_info["normalizedModel"],
                "firmware": device_info["deviceVersion"],
                "selectedSlot": selected_slot,
                "selector": selector,
                "properties": properties,
                "transactions": device.ledger,
                "sessionClosed": True,
                "interfaceRelease": "confirmed by process cleanup",
            }
        finally:
            if session_open:
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                except Exception:
                    pass


def safe_error(error: Exception) -> dict[str, Any]:
    result = {
        "code": getattr(error, "code", error.__class__.__name__),
        "message": str(error),
    }
    if isinstance(error, PtpResponseError):
        result.update({
            "operation": code_entry(error.operation, OPERATION_NAMES),
            "transactionId": error.transaction_id,
            "response": code_entry(error.response_code, RESPONSE_NAMES),
        })
    return result


def scan_recipe_slots() -> dict[str, Any]:
    """Scan C1-C7, changing only D18C and restoring its exact original bytes."""

    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        transactions = TransactionSequence()
        session_open = False
        original_payload: bytes | None = None
        selected_slot: int | None = None
        selector_changed = False
        slots: list[dict[str, Any]] = []
        fatal_error: dict[str, Any] | None = None
        cleanup = {
            "restoreRequired": False,
            "restoreAttempted": False,
            "restoreConfirmed": False,
            "restoreError": None,
            "sessionCloseAttempted": False,
            "sessionClosed": False,
        }
        device_info: dict[str, Any] | None = None
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            info_payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert info_payload is not None
            device_info = parse_device_info(info_payload)
            advertised = {int(entry["code"]) for entry in device_info["properties"]}
            operations = {int(entry["code"]) for entry in device_info["operations"]}
            if device_info["normalizedModel"] != "XE5":
                raise LabError("MODEL_GATE", "C-slot scanning is locked to normalized model XE5.")
            if 0xD18C not in advertised:
                raise LabError("SELECTOR_GATE", "DeviceInfo did not advertise recipe selector 0xD18C.")
            missing_operations = {GET_DEVICE_PROP_VALUE, SET_DEVICE_PROP_VALUE} - operations
            if missing_operations:
                missing = ", ".join(f"0x{code:04X}" for code in sorted(missing_operations))
                raise LabError("OPERATION_GATE", f"C-slot scanning is missing advertised operations: {missing}.")

            original_payload = device.transact(
                GET_DEVICE_PROP_VALUE,
                transactions.take(),
                [0xD18C],
                expect_data=True,
            )
            if original_payload is None or len(original_payload) != 2:
                raise LabError("SELECTOR_WIDTH", "Original D18C selector is not exactly two bytes.")
            selected_slot = int.from_bytes(original_payload, "little", signed=False)
            if selected_slot not in range(1, 8):
                raise LabError("SELECTOR_VALUE", "Original D18C selector is not C1 through C7.")

            for target in range(1, 8):
                selector_evidence = {
                    "changed": selected_slot != target,
                    "sameValueSelection": selected_slot == target,
                    "writeRequired": True,
                    "target": target,
                    "payload": struct.pack("<H", target).hex(" ").upper(),
                    "readBack": None,
                    "confirmed": False,
                }
                target_payload = struct.pack("<H", target)
                # Firmware 1.10 physically returned live/current settings when
                # the original slot was read without an explicit same-value
                # selector write. Every slot must therefore be selected before
                # its stored property block is read.
                selector_changed = True
                cleanup["restoreRequired"] = True
                device.set_recipe_selector(transactions.take(), target_payload)
                read_back = device.transact(
                    GET_DEVICE_PROP_VALUE,
                    transactions.take(),
                    [0xD18C],
                    expect_data=True,
                )
                assert read_back is not None
                selector_evidence["readBack"] = read_back.hex(" ").upper()
                selector_evidence["confirmed"] = read_back == target_payload
                if read_back != target_payload:
                    raise LabError(
                        "SELECTOR_READBACK",
                        f"C{target} selector read-back did not match the exact written payload.",
                    )
                selected_slot = target

                properties = []
                for property_code in range(0xD18D, 0xD1A6):
                    if property_code not in advertised:
                        properties.append({
                            "property": code_entry(property_code, PROPERTY_NAMES),
                            "rawHex": "",
                            "payloadWidth": 0,
                            "rawValue": None,
                            "canonical": None,
                            "readStatus": "NOT_ADVERTISED",
                            "normalization": None,
                            "uncertainty": "The same-session DeviceInfo did not advertise this property.",
                        })
                        continue
                    try:
                        property_payload = device.transact(
                            GET_DEVICE_PROP_VALUE,
                            transactions.take(),
                            [property_code],
                            expect_data=True,
                        )
                        assert property_payload is not None
                        properties.append(describe_recipe_payload(property_code, property_payload))
                    except PtpResponseError as error:
                        properties.append({
                            "property": code_entry(property_code, PROPERTY_NAMES),
                            "rawHex": "",
                            "payloadWidth": 0,
                            "rawValue": None,
                            "canonical": None,
                            "readStatus": "PTP_RESPONSE",
                            "response": code_entry(error.response_code, RESPONSE_NAMES),
                            "normalization": None,
                            "uncertainty": "The camera returned no payload; no value was inferred.",
                        })
                slots.append({
                    "id": f"C{target}",
                    "slot": target,
                    "selector": selector_evidence,
                    "properties": properties,
                })
        except Exception as error:
            fatal_error = safe_error(error)
        finally:
            if session_open and selector_changed and original_payload is not None:
                cleanup["restoreAttempted"] = True
                try:
                    device.set_recipe_selector(transactions.take(), original_payload)
                    restored = device.transact(
                        GET_DEVICE_PROP_VALUE,
                        transactions.take(),
                        [0xD18C],
                        expect_data=True,
                    )
                    cleanup["restoreReadBack"] = restored.hex(" ").upper() if restored is not None else ""
                    cleanup["restoreConfirmed"] = restored == original_payload
                    if restored != original_payload:
                        cleanup["restoreError"] = "Exact selector read-back did not match the original payload."
                except Exception as error:
                    cleanup["restoreError"] = safe_error(error)
            elif session_open and not selector_changed:
                cleanup["restoreConfirmed"] = original_payload is not None

            if session_open:
                cleanup["sessionCloseAttempted"] = True
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                    cleanup["sessionClosed"] = True
                    session_open = False
                except Exception as error:
                    cleanup["sessionCloseError"] = safe_error(error)

        original_slot = (
            int.from_bytes(original_payload, "little", signed=False)
            if original_payload is not None and len(original_payload) == 2
            else None
        )
        completed = (
            fatal_error is None
            and len(slots) == 7
            and all(
                len(slot["properties"]) == 25
                and all(prop["readStatus"] == "OK" for prop in slot["properties"])
                for slot in slots
            )
            and cleanup["restoreConfirmed"]
            and cleanup["sessionClosed"]
        )
        return {
            "stage": "CLI_C1_C7_SCAN",
            "readOnlyRecipeData": True,
            "temporaryMutation": "Only D18C selector values 1 through 7; exact original payload restored",
            "usb": usb,
            "model": device_info["model"] if device_info else None,
            "normalizedModel": device_info["normalizedModel"] if device_info else None,
            "firmware": device_info["deviceVersion"] if device_info else None,
            "originalSlot": original_slot,
            "originalSelectorRawHex": original_payload.hex(" ").upper() if original_payload else "",
            "slots": slots,
            "fatalError": fatal_error,
            "cleanup": cleanup,
            "transactions": device.ledger,
            "completed": completed,
            "interfaceRelease": "confirmed by process cleanup",
        }


def read_full_backup_transient(retain_for_volatile_comparison: bool = False) -> Any:
    """Read handle zero, validate and decode in memory.

    The default return value never contains the backup. The laboratory-only
    comparison mode can retain it in this process until a second read, but the
    bytes are still never written to disk or emitted to stdout.
    """

    with UsbPtpDevice(LibUsb()) as device:
        usb = device.safe_usb_diagnostics()
        transactions = TransactionSequence()
        session_open = False
        try:
            device.transact(OPEN_SESSION, transactions.take(), [1], expect_data=False)
            session_open = True
            info_payload = device.transact(GET_DEVICE_INFO, transactions.take(), [], expect_data=True)
            assert info_payload is not None
            device_info = parse_device_info(info_payload)
            operations = {int(entry["code"]) for entry in device_info["operations"]}
            if device_info["normalizedModel"] != "XE5":
                raise LabError("MODEL_GATE", "Full-backup reading is locked to normalized DeviceInfo model XE5.")
            missing = {GET_OBJECT_INFO, GET_OBJECT} - operations
            if missing:
                rendered = ", ".join(f"0x{code:04X}" for code in sorted(missing))
                raise LabError("OPERATION_GATE", f"DeviceInfo did not advertise required backup operations: {rendered}.")

            object_info_payload = device.transact(
                GET_OBJECT_INFO,
                transactions.take(),
                [BACKUP_HANDLE],
                expect_data=True,
            )
            assert object_info_payload is not None
            object_info = parse_object_info(object_info_payload)
            if object_info["objectFormat"] != BACKUP_FORMAT:
                raise LabError(
                    "BACKUP_FORMAT_GATE",
                    f"GetObjectInfo(0) reported format 0x{object_info['objectFormat']:04X}; expected 0x{BACKUP_FORMAT:04X}.",
                )
            if object_info["objectCompressedSize"] != X_E5_BACKUP_SIZE:
                raise LabError(
                    "BACKUP_DECLARED_SIZE_GATE",
                    f"GetObjectInfo(0) declared {object_info['objectCompressedSize']} bytes; expected exactly {X_E5_BACKUP_SIZE}.",
                )

            backup = device.transact(
                GET_OBJECT,
                transactions.take(),
                [BACKUP_HANDLE],
                expect_data=True,
            )
            assert backup is not None
            if len(backup) != object_info["objectCompressedSize"] or len(backup) != X_E5_BACKUP_SIZE:
                raise LabError(
                    "BACKUP_ACTUAL_SIZE_GATE",
                    f"GetObject(0) returned {len(backup)} bytes; declared and expected size is {X_E5_BACKUP_SIZE}.",
                )
            backup_model = model_from_backup(backup)
            if normalize_model(backup_model) != "XE5":
                raise LabError("BACKUP_MODEL_GATE", "The embedded backup model did not normalize to XE5.")

            digest = hashlib.sha256(backup).hexdigest()
            fs_slots = decode_fs_slots(backup)
            device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
            session_open = False
            report = {
                "stage": "CLI_READ_ONLY_FULL_BACKUP",
                "readOnly": True,
                "policy": "Only GetObjectInfo(0) and GetObject(0); no SendObjectInfo, SendObject, DeleteObject, patch, or restore",
                "warning": "A Fujifilm settings backup can contain the full camera serial number. The binary was held only in volatile process memory and was not emitted or persisted.",
                "persistence": "NONE_VOLATILE_MEMORY_ONLY",
                "usb": usb,
                "deviceInfoModel": device_info["model"],
                "backupModel": backup_model,
                "normalizedModel": "XE5",
                "firmware": device_info["deviceVersion"],
                "objectHandle": BACKUP_HANDLE,
                "objectInfo": object_info,
                "objectFormat": object_info["objectFormat"],
                "declaredSize": object_info["objectCompressedSize"],
                "actualSize": len(backup),
                "expectedSize": X_E5_BACKUP_SIZE,
                "sha256": digest,
                "decodeGate": {
                    "deviceInfoModelIsXe5": True,
                    "backupModelIsXe5": True,
                    "objectFormatMatches": True,
                    "declaredSizeMatchesActual": True,
                    "exactExpectedSize": True,
                    "passed": True,
                },
                "fsSlots": fs_slots,
                "transactions": device.ledger,
                "sessionClosed": True,
                "interfaceRelease": "confirmed by process cleanup",
            }
            if retain_for_volatile_comparison:
                return report, bytes(backup)
            # The backup becomes unreachable when this function returns and
            # was never written to disk or stdout.
            return report
        finally:
            if session_open:
                try:
                    device.transact(CLOSE_SESSION, transactions.take(), [], expect_data=False)
                except Exception:
                    pass


def compare_xe5_backups(before: bytes, after: bytes, slot: int = 0) -> dict[str, Any]:
    """Return a bounded, non-sensitive byte-difference report for one FS slot."""

    for label, blob in (("before", before), ("after", after)):
        if len(blob) != X_E5_BACKUP_SIZE or normalize_model(model_from_backup(blob)) != "XE5":
            raise LabError("BACKUP_COMPARE_GATE", f"The {label} backup failed the exact X-E5 model/size gate.")
    if slot not in range(3):
        raise LabError("FS_SLOT_GATE", f"FS slot index {slot} is outside 0..2.")

    changed_offsets = [index for index, pair in enumerate(zip(before, after)) if pair[0] != pair[1]]
    if len(changed_offsets) > 512:
        raise LabError(
            "BACKUP_DIFF_TOO_BROAD",
            f"The two backups differ at {len(changed_offsets)} offsets; the bounded FS{slot + 1} characterization limit is 512.",
        )

    known_offsets: dict[int, str] = {}
    known_field_changes = []
    enabled_offset = FS_RECIPE_ENABLED_OFFSETS.get(slot)
    if enabled_offset is not None:
        known_offsets[enabled_offset] = "fsRecipeEnabled"
    if enabled_offset is not None and before[enabled_offset] != after[enabled_offset]:
        known_field_changes.append({
            "field": "fsRecipeEnabled",
            "offset": enabled_offset,
            "payloadWidth": 1,
            "beforeHex": f"{before[enabled_offset]:02X}",
            "afterHex": f"{after[enabled_offset]:02X}",
            "evidenceLevel": "PHYSICAL_X_E5_FW_1_10",
        })
    for key, (base, step, width) in FS_FIELDS.items():
        offset = base + slot * step
        for index in range(offset, offset + width):
            known_offsets[index] = key
        before_slice = before[offset:offset + width]
        after_slice = after[offset:offset + width]
        if before_slice != after_slice:
            known_field_changes.append({
                "field": key,
                "offset": offset,
                "payloadWidth": width,
                "beforeHex": before_slice.hex(" ").upper(),
                "afterHex": after_slice.hex(" ").upper(),
            })

    checksum_offsets = {FS_CHECKSUM_OFFSET, FS_CHECKSUM_OFFSET + 1}
    unmapped_changes = [
        {
            "offset": index,
            "beforeHex": f"{before[index]:02X}",
            "afterHex": f"{after[index]:02X}",
        }
        for index in changed_offsets
        if index not in known_offsets and index not in checksum_offsets
    ]
    checksum_before = int.from_bytes(before[FS_CHECKSUM_OFFSET:FS_CHECKSUM_OFFSET + 2], "little")
    checksum_after = int.from_bytes(after[FS_CHECKSUM_OFFSET:FS_CHECKSUM_OFFSET + 2], "little")
    data_delta = sum(
        after[index] - before[index]
        for index in changed_offsets
        if index not in checksum_offsets
    )

    result = {
        "stage": f"CLI_FS{slot + 1}_VOLATILE_BEFORE_AFTER",
        "selectedSlot": f"FS{slot + 1}",
        "readOnlyTransport": True,
        "manualMutation": f"The owner changed FS{slot + 1} through the physical X-E5 menu between two read-only handle-zero backup reads.",
        "warning": "Neither full backup is emitted or persisted. Only bounded changed byte offsets are reported.",
        "beforeSha256": hashlib.sha256(before).hexdigest(),
        "afterSha256": hashlib.sha256(after).hexdigest(),
        "exactSize": len(after),
        "changedOffsetCount": len(changed_offsets),
        "knownFsFieldChanges": known_field_changes,
        "checksumObservation": {
            "offset": FS_CHECKSUM_OFFSET,
            "before": checksum_before,
            "after": checksum_after,
            "moduloDelta": (checksum_after - checksum_before) & 0xFFFF,
            "changedDataByteSumDelta": data_delta,
            "deltaMatchesModuloByteSum": ((checksum_after - checksum_before) & 0xFFFF) == (data_delta & 0xFFFF),
        },
        "unmappedChangedOffsets": unmapped_changes,
        "unmappedChangedOffsetCount": len(unmapped_changes),
        "fullBackupBytesEmitted": False,
        "persistence": "NONE_VOLATILE_MEMORY_ONLY",
    }
    if slot == 0:
        result["knownFs1FieldChanges"] = known_field_changes
    return result


def characterize_fs_with_volatile_backups(slot: int) -> dict[str, Any]:
    """Hold a baseline in RAM while the owner changes one FS slot, then compare."""

    before_report, before = read_full_backup_transient(retain_for_volatile_comparison=True)
    waiting = {
        "stage": f"WAITING_FOR_OWNER_FS{slot + 1}_MENU_CHANGE",
        "beforeSha256": before_report["sha256"],
        "usbReleased": True,
        "backupPersistence": "VOLATILE_MEMORY_ONLY",
        "instruction": f"Disconnect USB, configure only FS{slot + 1}, reconnect, then press Enter.",
    }
    print(json.dumps(waiting, indent=2), flush=True)
    input()
    after_report, after = read_full_backup_transient(retain_for_volatile_comparison=True)
    comparison = compare_xe5_backups(before, after, slot)
    comparison["beforeRead"] = {
        "sha256": before_report["sha256"],
        "sessionClosed": before_report["sessionClosed"],
        "interfaceRelease": before_report["interfaceRelease"],
    }
    comparison["afterRead"] = {
        "sha256": after_report["sha256"],
        "sessionClosed": after_report["sessionClosed"],
        "interfaceRelease": after_report["interfaceRelease"],
        "decodedValues": after_report["fsSlots"][slot]["values"],
    }
    return comparison


def encode_ptp_string(value: str) -> bytes:
    return bytes([len(value) + 1]) + value.encode("utf-16le") + b"\x00\x00"


def self_test() -> dict[str, Any]:
    secret = "SELF-TEST-SECRET-SERIAL"
    u16_array = lambda values: struct.pack("<I", len(values)) + b"".join(struct.pack("<H", value) for value in values)
    payload = b"".join([
        struct.pack("<HIH", 100, 6, 100),
        encode_ptp_string("fujifilm.co.jp: 1.0; "),
        struct.pack("<H", 0),
        u16_array([OPEN_SESSION, GET_DEVICE_INFO, CLOSE_SESSION, 0x9801]),
        u16_array([0x4006]),
        u16_array([0x5001, 0xD406]),
        u16_array([]),
        u16_array([0x3801]),
        encode_ptp_string("FUJIFILM"),
        encode_ptp_string("X-E5"),
        encode_ptp_string("1.10"),
        encode_ptp_string(secret),
    ])
    parsed = parse_device_info(payload)
    rendered = json.dumps(parsed)
    assert secret not in rendered
    assert parsed["serial"] == "[REDACTED]"
    assert parsed["normalizedModel"] == "XE5"
    assert parsed["recipeSelectorAdvertised"] is False
    assert parsed["operations"][-1]["name"] == "MTP_GET_OBJECT_PROPS_SUPPORTED"
    try:
        DatasetReader(b"\x02A\x00B\x00").ptp_string()
    except LabError as error:
        assert error.code == "MALFORMED_PTP_STRING"
    else:
        raise AssertionError("A non-terminated PTP string crossed the dataset parser boundary.")
    object_info_payload = struct.pack(
        "<IHHIHIIIIIIIHII",
        0,
        BACKUP_FORMAT,
        0,
        X_E5_BACKUP_SIZE,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
    ) + encode_ptp_string(f"{secret}.DAT") + encode_ptp_string("") * 3
    parsed_object_info = parse_object_info(object_info_payload)
    assert parsed_object_info["objectFormat"] == BACKUP_FORMAT
    assert parsed_object_info["objectCompressedSize"] == X_E5_BACKUP_SIZE
    assert secret not in json.dumps(parsed_object_info)
    backup = bytearray(X_E5_BACKUP_SIZE)
    backup[:8] = b"FUJIFILM"
    backup[0x14:0x19] = b"X-E5\x00"
    backup[FS_FIELDS["filmSimulation"][0]] = 0x01
    backup[FS_FIELDS["whiteBalanceMode"][0]] = 0x0A
    backup[FS_FIELDS["whiteBalanceKelvin"][0]:FS_FIELDS["whiteBalanceKelvin"][0] + 2] = struct.pack("<H", 7500)
    backup[FS_FIELDS["dynamicRange"][0]] = 1
    backup[FS_FIELDS["color"][0]] = 10
    backup[FS_FIELDS["sharpness"][0]] = 8
    backup[FS_FIELDS["highIsoNr"][0]] = 0
    backup[FS_FIELDS["clarity"][0]] = 2
    backup[FS_FIELDS["highlight"][0]] = 0
    backup[FS_FIELDS["shadow"][0]] = 0
    backup[FS_FIELDS["wbShiftR"][0]] = 9
    backup[FS_FIELDS["wbShiftB"][0]] = 9
    backup[FS1_RECIPE_ENABLED_OFFSET] = 1
    decoded_fs = decode_fs_slots(bytes(backup))
    assert decoded_fs[0]["fsRecipeStatus"] == "ON"
    assert decoded_fs[0]["values"]["filmSimulation"] == "Provia"
    assert decoded_fs[0]["values"]["whiteBalanceKelvin"] == 7500
    assert decoded_fs[0]["values"]["highIsoNr"] == -4
    assert "rawHex" not in decoded_fs[0]["properties"][0]
    fs2_blob = bytearray(backup)
    for key, expected_raw in FS2_PHYSICAL_TARGET_RAW.items():
        base, step, width = FS_FIELDS[key]
        fs2_blob[base + step:base + step + width] = int(expected_raw).to_bytes(width, "little")
    decoded_fs2 = decode_fs_slots(bytes(fs2_blob))[1]
    assert decoded_fs2["fsRecipeStatus"] == "UNKNOWN_FROM_BACKUP"
    assert decoded_fs2["valuesActive"] is None
    assert decoded_fs2["values"]["dynamicRange"] == "DR200"
    assert decoded_fs2["values"]["color"] == -2
    assert decoded_fs2["values"]["whiteBalanceKelvin"] == 3200
    assert decoded_fs2["values"]["wbShiftR"] == 8
    assert decoded_fs2["values"]["wbShiftB"] == -8
    assert next(item for item in decoded_fs2["properties"] if item["key"] == "dynamicRange")["evidenceLevel"] == "PHYSICAL_X_E5_FW_1_10"
    fs3_blob = bytearray(backup)
    for key, expected_raw in FS3_PHYSICAL_TARGET_RAW.items():
        base, step, width = FS_FIELDS[key]
        fs3_blob[base + 2 * step:base + 2 * step + width] = int(expected_raw).to_bytes(width, "little")
    fs3_blob[FS3_RECIPE_ENABLED_OFFSET] = 1
    decoded_fs3 = decode_fs_slots(bytes(fs3_blob))[2]
    assert decoded_fs3["fsRecipeStatus"] == "ON"
    assert decoded_fs3["valuesActive"] is True
    assert decoded_fs3["values"]["filmSimulation"] == "Acros"
    assert decoded_fs3["values"]["wbShiftR"] == 0
    assert decoded_fs3["values"]["wbShiftB"] == 0
    assert decoded_fs3["values"]["clarity"] == 5
    assert next(item for item in decoded_fs3["properties"] if item["key"] == "fsRecipeEnabled")["offset"] == FS3_RECIPE_ENABLED_OFFSET
    comparison_before_mutable = bytearray(backup)
    comparison_before_mutable[FS_CHECKSUM_OFFSET:FS_CHECKSUM_OFFSET + 2] = struct.pack("<H", 0x1000)
    comparison_before = bytes(comparison_before_mutable)
    comparison_after = bytearray(comparison_before)
    comparison_after[FS_FIELDS["filmSimulation"][0]] = 0x0F
    comparison_after[12345] = 1
    comparison_after[FS_CHECKSUM_OFFSET:FS_CHECKSUM_OFFSET + 2] = struct.pack("<H", 0x1002)
    comparison = compare_xe5_backups(comparison_before, bytes(comparison_after))
    assert comparison["changedOffsetCount"] == 3
    assert comparison["knownFs1FieldChanges"][0]["field"] == "filmSimulation"
    assert comparison["unmappedChangedOffsets"] == [{"offset": 12345, "beforeHex": "00", "afterHex": "01"}]
    assert comparison["fullBackupBytesEmitted"] is False
    rendered_comparison = json.dumps(comparison)
    assert "FUJIFILM" not in rendered_comparison
    assert "beforeBytes" not in rendered_comparison and "afterBytes" not in rendered_comparison
    flag_after = bytearray(comparison_before)
    flag_after[FS1_RECIPE_ENABLED_OFFSET] = 0
    flag_after[FS_CHECKSUM_OFFSET:FS_CHECKSUM_OFFSET + 2] = struct.pack("<H", 0x0FFF)
    flag_comparison = compare_xe5_backups(comparison_before, bytes(flag_after))
    assert flag_comparison["knownFs1FieldChanges"][0]["field"] == "fsRecipeEnabled"
    assert flag_comparison["knownFs1FieldChanges"][0]["beforeHex"] == "01"
    assert flag_comparison["knownFs1FieldChanges"][0]["afterHex"] == "00"
    fs3_after = bytearray(comparison_before)
    fs3_film_offset = FS_FIELDS["filmSimulation"][0] + 2 * FS_FIELDS["filmSimulation"][1]
    fs3_after[fs3_film_offset] = 0x16
    fs3_comparison = compare_xe5_backups(comparison_before, bytes(fs3_after), 2)
    assert fs3_comparison["selectedSlot"] == "FS3"
    assert fs3_comparison["knownFsFieldChanges"] == [{
        "field": "filmSimulation", "offset": fs3_film_offset,
        "payloadWidth": 1, "beforeHex": f"{comparison_before[fs3_film_offset]:02X}", "afterHex": "16",
    }]
    assert "knownFs1FieldChanges" not in fs3_comparison
    descriptor = struct.pack("<HHBHHB", 0x5001, 0x0004, 0, 100, 75, 0)
    parsed_descriptor = parse_property_descriptor(descriptor, 0x5001)
    assert parsed_descriptor["current"]["value"] == 75
    assert parsed_descriptor["current"]["width"] == 2
    descriptor_error = rejected_property_descriptor(
        0xD18D,
        PtpResponseError(GET_DEVICE_PROP_DESC, 27, 0x2002),
    )
    assert descriptor_error["property"]["code"] == 0xD18D
    assert descriptor_error["response"]["name"] == "GENERAL_ERROR"
    assert descriptor_error["transactionId"] == 27
    sequence = TransactionSequence()
    assert [sequence.take(), sequence.take(), sequence.take()] == [0, 1, 2]
    usb_mode = decode_fuji_usb_mode(b"\x06\x00")
    assert usb_mode["rawValue"] == 6
    assert usb_mode["payloadWidth"] == 2
    assert usb_mode["canonical"] == "USB_RAW_CONVERSION_BACKUP_RESTORE"
    fake_device = object.__new__(UsbPtpDevice)
    fake_device.ledger = []
    selector_writes: list[bytes] = []
    fake_device._bulk_write = selector_writes.append
    fake_device._read_container = lambda: (PTP_RESPONSE, PTP_OK, 9, b"")
    fake_device.set_recipe_selector(9, b"\x07\x00")
    assert len(selector_writes) == 2
    assert struct.unpack_from("<IHHII", selector_writes[0]) == (16, PTP_COMMAND, SET_DEVICE_PROP_VALUE, 9, 0xD18C)
    assert struct.unpack_from("<IHHI", selector_writes[1]) == (14, PTP_DATA, SET_DEVICE_PROP_VALUE, 9)
    assert selector_writes[1][12:] == b"\x07\x00"
    for invalid_selector in (b"", b"\x00\x00", b"\x08\x00", b"\x01\x00\x00"):
        try:
            fake_device.set_recipe_selector(10, invalid_selector)
        except LabError as error:
            assert error.code == "POLICY_DENIED"
        else:
            raise AssertionError("Invalid selector payload crossed the CLI policy boundary.")
    fake_policy_device = object.__new__(UsbPtpDevice)
    fake_policy_device.ledger = []
    try:
        fake_policy_device.transact(GET_OBJECT, 1, [1], expect_data=True)
    except LabError as error:
        assert error.code == "POLICY_DENIED"
    else:
        raise AssertionError("A nonzero backup object handle crossed the CLI policy boundary.")
    return {
        "status": "PASS",
        "serialBoundary": "REDACTED",
        "datasetParser": "PASS",
        "strictPtpStrings": "PASS",
        "transactionSequence": "PASS",
        "usbModeDecoder": "PASS",
        "selectorWritePolicy": "PASS",
        "objectInfoParser": "PASS",
        "descriptorResponseContinuation": "PASS",
        "backupModelSizeFsDecoder": "PASS",
        "backupHandlePolicy": "PASS",
        "volatileBackupDiffBoundary": "PASS",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("discover", "advertised-properties", "usb-mode", "current-recipe", "scan-recipes", "backup-read", "fs1-diff-lab", "fs-diff-lab", "self-test"),
    )
    parser.add_argument(
        "--after-complete-c-scan",
        action="store_true",
        help="Required acknowledgement that the guarded C1-C7 scan completed before a backup read.",
    )
    parser.add_argument(
        "--fs-slot",
        type=int,
        choices=(1, 2, 3),
        default=1,
        help="FS position for fs-diff-lab; defaults to FS1.",
    )
    args = parser.parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        elif args.command == "advertised-properties":
            result = inspect_advertised_properties()
        elif args.command == "usb-mode":
            result = inspect_fuji_usb_mode()
        elif args.command == "current-recipe":
            result = read_current_recipe_slot()
        elif args.command == "scan-recipes":
            result = scan_recipe_slots()
        elif args.command == "backup-read":
            if not args.after_complete_c_scan:
                raise LabError("STAGE_GATE", "backup-read requires --after-complete-c-scan.")
            result = read_full_backup_transient()
        elif args.command == "fs1-diff-lab":
            if not args.after_complete_c_scan:
                raise LabError("STAGE_GATE", "fs1-diff-lab requires --after-complete-c-scan.")
            result = characterize_fs_with_volatile_backups(0)
        elif args.command == "fs-diff-lab":
            if not args.after_complete_c_scan:
                raise LabError("STAGE_GATE", "fs-diff-lab requires --after-complete-c-scan.")
            result = characterize_fs_with_volatile_backups(args.fs_slot - 1)
        else:
            result = discover()
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    except Exception as error:
        safe = {
            "status": "FAILED",
            "errorCode": getattr(error, "code", error.__class__.__name__),
            "message": str(error),
            "serial": "[NEVER EMITTED]",
        }
        print(json.dumps(safe, indent=2, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
