"""Generates the small EXIF-tagged JPEGs used by photoImport.spec.js (run once; outputs are committed).

    python tests/e2e/fixtures/make_photo_fixtures.py
"""
from pathlib import Path

from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational

OUT = Path(__file__).resolve().parent / "photos"


def dms(value):
    value = abs(value)
    d = int(value)
    m = int((value - d) * 60)
    s = round(((value - d) * 60 - m) * 60 * 100)
    return (IFDRational(d, 1), IFDRational(m, 1), IFDRational(s, 100))


def make(name, color, when=None, lat=None, lng=None, offset=None):
    img = Image.new("RGB", (1200, 900), color)
    draw = ImageDraw.Draw(img)
    for i in range(0, 1200, 60):
        draw.line([(i, 0), (1200 - i, 900)], fill=(255, 255, 255), width=3)
    exif = img.getexif()
    if when:
        exif[0x0132] = when  # DateTime
        sub = exif.get_ifd(0x8769)
        sub[0x9003] = when  # DateTimeOriginal
        if offset:
            sub[0x9011] = offset  # OffsetTimeOriginal
    if lat is not None:
        gps = exif.get_ifd(0x8825)
        gps[1] = "N" if lat >= 0 else "S"
        gps[2] = dms(lat)
        gps[3] = "E" if lng >= 0 else "W"
        gps[4] = dms(lng)
    img.save(OUT / name, format="JPEG", quality=70, exif=exif.tobytes())


def make_takeout():
    """A Google Takeout-style folder: photos WITHOUT EXIF + JSON sidecars (all naming variants)."""
    import json
    import calendar
    album = Path(__file__).resolve().parent / "takeout" / "Takeout" / "Google Photos" / "Weekend in Porto"
    album.mkdir(parents=True, exist_ok=True)

    def ts(y, mo, d, h, mi):  # UTC timestamp, as Takeout stores it
        return str(calendar.timegm((y, mo, d, h, mi, 0)))

    def plain(name, color):
        Image.new("RGB", (900, 600), color).save(album / name, format="JPEG", quality=70)

    def sidecar(name, title, stamp, lat, lng, people=(), description=""):
        data = {
            "title": title,
            "description": description,
            "photoTakenTime": {"timestamp": stamp, "formatted": ""},
            "geoData": {"latitude": lat, "longitude": lng, "altitude": 0.0},
            "geoDataExif": {"latitude": 0.0, "longitude": 0.0, "altitude": 0.0},
            "people": [{"name": p} for p in people],
        }
        (album / name).write_text(json.dumps(data), encoding="utf-8")

    plain("DSC_0101.jpg", (30, 80, 160))
    sidecar("DSC_0101.jpg.json", "DSC_0101.jpg", ts(2021, 9, 18, 10, 0), 41.1406, -8.6110, ["Dana", "Avi"], "Ribeira at last!")
    plain("DSC_0102.jpg", (40, 90, 170))
    sidecar("DSC_0102.jpg.supplemental-metadata.json", "DSC_0102.jpg", ts(2021, 9, 18, 11, 30), 41.1410, -8.6115, ["Dana"])
    plain("DSC_0103_a_rather_long_file_name_from_an_app.jpg", (50, 100, 180))
    sidecar("DSC_0103_a_rather_long_file_name_from_an_app.jpg.supplemen.json", "DSC_0103_a_rather_long_file_name_from_an_app.jpg", ts(2021, 9, 18, 13, 0), 41.1420, -8.6120)
    plain("DSC_0101(1).jpg", (60, 110, 190))
    sidecar("DSC_0101.jpg(1).json", "DSC_0101.jpg", ts(2021, 9, 18, 14, 15), 41.1400, -8.6100, ["Avi"])
    # Not a photo, and a metadata file for the album itself: both must be ignored quietly.
    (album / "metadata.json").write_text(json.dumps({"title": "Weekend in Porto"}), encoding="utf-8")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    make("lisbon-1.jpg", (180, 90, 40), "2023:05:12 09:10:00", 38.7139, -9.1394, "+01:00")
    make("lisbon-2.jpg", (200, 120, 50), "2023:05:12 10:05:00", 38.7110, -9.1330, "+01:00")
    make("lisbon-3.jpg", (160, 80, 30), "2023:05:12 11:40:00", 38.7150, -9.1400, "+01:00")
    make("porto-1.jpg", (40, 90, 180), "2023:05:14 18:20:00", 41.1496, -8.6110, "+01:00")
    make("porto-2.jpg", (50, 110, 200), "2023:05:14 19:02:00", 41.1410, -8.6090, "+01:00")
    make("scan-no-date.jpg", (90, 90, 90))
    make_takeout()
    print("wrote", sorted(p.name for p in OUT.iterdir()))
