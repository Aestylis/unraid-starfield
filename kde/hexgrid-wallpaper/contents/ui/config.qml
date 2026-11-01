import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    // Plasma passes these in; declaring them silences "does not have a property" warnings
    property var wallpaperConfiguration
    property var configDialog

    property alias cfg_hexSize: hexSpin.value
    property alias cfg_fps: fpsSpin.value
    property alias cfg_swapsPerSecond: swapSpin.value

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
}
