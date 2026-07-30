import os
from PIL import Image, ImageDraw, ImageFont

os.makedirs('/Users/julian/antigravity/DZZ/icons', exist_ok=True)

def create_icon(bg_color, glow_color, status_text, output_path):
    size = (512, 512)
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 绘制外层圆角矩形
    padding = 20
    rect = [padding, padding, size[0] - padding, size[1] - padding]
    draw.rounded_rectangle(rect, radius=90, fill=(15, 23, 42, 240), outline=glow_color, width=8)
    
    # 绘制中央发光圆形
    center = (256, 210)
    r = 110
    draw.ellipse([center[0]-r, center[1]-r, center[0]+r, center[1]+r], fill=bg_color, outline=glow_color, width=6)
    
    # 绘制文字标志
    try:
        font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 72)
        font_sub = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 48)
    except:
        font = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        
    # 绘制文本 ON/OFF
    text_bbox = draw.textbbox((0, 0), status_text, font=font)
    tw = text_bbox[2] - text_bbox[0]
    th = text_bbox[3] - text_bbox[1]
    draw.text((center[0] - tw/2, center[1] - th/2 - 5), status_text, fill=(255, 255, 255, 255), font=font)
    
    # 底部标签
    label = "考试助手"
    l_bbox = draw.textbbox((0, 0), label, font=font_sub)
    lw = l_bbox[2] - l_bbox[0]
    draw.text((256 - lw/2, 380), label, fill=glow_color, font=font_sub)
    
    img.save(output_path, "PNG")

# 生成绿色的 ON 图标与红色的 OFF 图标
create_icon((16, 185, 129, 220), (52, 211, 153, 255), "ON", "/Users/julian/antigravity/DZZ/icons/on.png")
create_icon((239, 68, 68, 220), (248, 113, 113, 255), "OFF", "/Users/julian/antigravity/DZZ/icons/off.png")
print("Icons generated successfully!")
