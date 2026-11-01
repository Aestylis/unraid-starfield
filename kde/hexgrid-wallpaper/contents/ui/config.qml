import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    property alias cfg_hexSize: hexSpin.value
    property alias cfg_fps: fpsSpin.value
    property alias cfg_swapsPerSecond: swapSpin.value
    property alias cfg_mouseGlow: glowCheck.checked

    QQC2.SpinBox {
        id: hexSpin
        Kirigami.FormData.label: i18n("Hex size (px):")
        from: 14; to: 80
    }
    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: i18n("Frame rate:")
        from: 5; to: 60
    }
    QQC2.SpinBox {
        id: swapSpin
        Kirigami.FormData.label: i18n("Swaps per second:")
        from: 0; to: 20
    }
    QQC2.CheckBox {
        id: glowCheck
        Kirigami.FormData.label: i18n("Cursor:")
        text: i18n("Warm hexes under the pointer")
    }
}
