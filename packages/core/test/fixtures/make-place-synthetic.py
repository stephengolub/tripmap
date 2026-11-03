"""Write place-synthetic.bplist: an NSKeyedArchiver plist shaped like the reverse geocode
Photos stores in ZREVERSELOCATIONDATA. Every name and number here is invented.

Run from this directory: python3 -I make-place-synthetic.py
"""
import plistlib
from plistlib import UID

objects = ["$null"]


def add(value):
    objects.append(value)
    return UID(len(objects) - 1)


def place(kind, name, area):
    return add({"placeType": kind, "name": add(name), "area": area})


infos = [
    place(4, "Testville", 3.0e7),
    place(6, "Testham", 2.0e6),
    place(8, "Example Point", 1.0e6),
    place(8, "Testmoor SAC", 5.0e5),  # designation: smaller, so it would win if not skipped
    place(11, "Test Isle", 4.0e7),
    place(17, "Guesthouse Lane", 1.0e2),  # street level: must never be read
    place(7, "Test Bay", 1.0e9),
]
sorted_infos = add({"NS.objects": infos})
map_item = add({"sortedPlaceInfos": sorted_infos})
postal = add({"_city": add("Testville"), "_state": add("Test County"), "_country": add("Testland"),
              "_street": add("Guesthouse Lane")})
root = add({"postalAddress": postal, "countryCode": add("TL"), "mapItem": map_item})

archive = {"$archiver": "NSKeyedArchiver", "$version": 100000, "$top": {"root": root},
           "$objects": objects}
with open("place-synthetic.bplist", "wb") as f:
    plistlib.dump(archive, f, fmt=plistlib.FMT_BINARY)
