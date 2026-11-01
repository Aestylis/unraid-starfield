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
    property real cfg_latitude: 42.51
    property real cfg_longitude: -123.39
    property int cfg_previewHour: -1

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
        model: [i18n("Follows the day (snow builds overnight, ploughed after sunrise)"), i18n("Always clear"), i18n("Always buried")]
    }
    QQC2.TextField {
        Kirigami.FormData.label: i18n("Latitude:")
        text: root.cfg_latitude.toFixed(4)
        validator: DoubleValidator { bottom: -90; top: 90 }
        onEditingFinished: root.cfg_latitude = parseFloat(text)
    }
    QQC2.TextField {
        Kirigami.FormData.label: i18n("Longitude:")
        text: root.cfg_longitude.toFixed(4)
        validator: DoubleValidator { bottom: -180; top: 180 }
        onEditingFinished: root.cfg_longitude = parseFloat(text)
    }
    QQC2.Label {
        text: i18n("Default: Grants Pass, OR (west is negative). Drives real sunrise, sunset and sun position.")
        font: Kirigami.Theme.smallFont
        opacity: 0.7
    }
    QQC2.ComboBox {
        Kirigami.FormData.label: i18n("Time of day:")
        model: {
            var m = [i18n("Live (real time)")]
            for (var h = 0; h < 24; h++) m.push(i18n("Preview %1:00", h))
            return m
        }
        currentIndex: root.cfg_previewHour + 1
        onActivated: root.cfg_previewHour = currentIndex - 1
    }
}
