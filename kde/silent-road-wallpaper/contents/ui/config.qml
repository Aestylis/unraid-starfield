import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: root

    // Plasma passes these in; declaring them silences "does not have a property" warnings
    property var wallpaperConfiguration
    property var configDialog

    property alias cfg_scene: sceneCombo.currentIndex
    property alias cfg_pixelSize: pixSpin.value
    property alias cfg_fps: fpsSpin.value
    property alias cfg_snowDensity: snowSlider.value
    property alias cfg_fogDensity: fogSlider.value
    property alias cfg_windStrength: windSlider.value
    property alias cfg_flicker: flickerSlider.value
    property alias cfg_erosionMode: erosionCombo.currentIndex

    QQC2.ComboBox {
        id: sceneCombo
        Kirigami.FormData.label: i18n("Scene:")
        model: [i18n("Road"), i18n("Sky (for a monitor above the road)")]
    }
    QQC2.SpinBox {
        id: pixSpin
        Kirigami.FormData.label: i18n("Pixel size:")
        from: 2; to: 8
    }
    QQC2.SpinBox {
        id: fpsSpin
        Kirigami.FormData.label: i18n("Frame rate:")
        from: 5; to: 60
    }
    QQC2.Slider {
        id: snowSlider
        Kirigami.FormData.label: i18n("Snow:")
        from: 0; to: 100; stepSize: 1
    }
    QQC2.Slider {
        id: fogSlider
        Kirigami.FormData.label: i18n("Fog:")
        from: 0; to: 100; stepSize: 1
    }
    QQC2.Slider {
        id: windSlider
        Kirigami.FormData.label: i18n("Wind:")
        from: 0; to: 100; stepSize: 1
    }
    QQC2.Slider {
        id: flickerSlider
        Kirigami.FormData.label: i18n("Lamp flicker:")
        from: 0; to: 100; stepSize: 1
    }
    QQC2.ComboBox {
        id: erosionCombo
        Kirigami.FormData.label: i18n("Winter:")
        model: [i18n("Follows the night (road fades toward 3:30 AM)"), i18n("Always clear"), i18n("Always buried")]
    }
}
