"""Fotos SINTÉTICAS para probar el visor: cuadrantes de color y una cuña asimétrica (para ver orientación). Nada de fotos reales."""
import sys, os, struct
from PIL import Image, ImageDraw
import pillow_heif

pillow_heif.register_heif_opener()
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

W, H = 240, 160
def base():
    im = Image.new("RGB", (W, H), (240, 240, 240))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W // 2 - 1, H // 2 - 1], fill=(220, 30, 30))      # arriba-izquierda: rojo
    d.rectangle([W // 2, 0, W - 1, H // 2 - 1], fill=(30, 180, 60))      # arriba-derecha: verde
    d.rectangle([0, H // 2, W // 2 - 1, H - 1], fill=(30, 60, 220))      # abajo-izquierda: azul
    d.rectangle([W // 2, H // 2, W - 1, H - 1], fill=(240, 220, 20))     # abajo-derecha: amarillo
    d.polygon([(10, 10), (70, 10), (10, 70)], fill=(0, 0, 0))            # cuña negra en la esquina arriba-izquierda
    return im

def exif_with_orientation(value):
    # EXIF mínimo (TIFF little endian) con sólo la etiqueta Orientation (0x0112).
    tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 1) + struct.pack("<HHI", 0x0112, 3, 1) + struct.pack("<HH", value, 0) + struct.pack("<I", 0)
    return b"Exif\x00\x00" + tiff

im = base()
im.save(os.path.join(out, "plana.jpg"), "JPEG", quality=92)
im.save(os.path.join(out, "plana.png"), "PNG")
im.save(os.path.join(out, "plana.heic"), "HEIF", quality=90)

# JPEG con orientación EXIF 6 (el navegador debe mostrarla girada 90° a la derecha → 160×240)
im.save(os.path.join(out, "orientada.jpg"), "JPEG", quality=92, exif=exif_with_orientation(6))

# HEIC con rotación del contenedor: se guarda con orientación 6 en EXIF y libheif escribe irot si se le pide
try:
    heif = pillow_heif.from_pillow(im)
    heif.info["exif"] = exif_with_orientation(6)
    heif.save(os.path.join(out, "orientada.heic"), quality=90)
except Exception as e:
    print("sin orientada.heic:", e)

# archivos inválidos
with open(os.path.join(out, "invalida.heic"), "wb") as f:
    f.write(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + os.urandom(400))
with open(os.path.join(out, "texto.jpg"), "wb") as f:
    f.write(b"esto no es una imagen, aunque se llame jpg")
data = open(os.path.join(out, "plana.jpg"), "rb").read()
with open(os.path.join(out, "cortada.jpg"), "wb") as f:
    f.write(data[: len(data) // 3])
with open(os.path.join(out, "vacia.heic"), "wb") as f:
    pass
print(sorted(os.listdir(out)))
