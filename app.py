
import io, os, re, json, zipfile
from urllib.parse import quote_plus
import streamlit as st
import feedparser
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps
from openai import OpenAI

st.set_page_config(page_title="원카드 뉴스 메이커", page_icon="📰", layout="centered")

st.markdown("""
<style>
.block-container {max-width:760px;padding-top:1rem;padding-bottom:3rem}
h1{font-size:1.85rem!important}
.stButton>button,.stDownloadButton>button{width:100%;min-height:52px;border-radius:14px;font-weight:800}
textarea,input{font-size:17px!important}
</style>
""", unsafe_allow_html=True)

FONT_BOLD = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
]
FONT_REG = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
]
def pick(paths):
    for p in paths:
        if os.path.exists(p): return p
    return None
FB, FR = pick(FONT_BOLD), pick(FONT_REG)

def fnt(size,bold=False):
    p=FB if bold else FR
    return ImageFont.truetype(p,size) if p else ImageFont.load_default()

def clean(s):
    return BeautifulSoup(s or "","html.parser").get_text(" ",strip=True)

def news_search(topic):
    url=f"https://news.google.com/rss/search?q={quote_plus(topic)}&hl=ko&gl=KR&ceid=KR:ko"
    feed=feedparser.parse(url)
    out=[]
    for e in feed.entries[:8]:
        out.append({
            "title":getattr(e,"title",""),
            "summary":clean(getattr(e,"summary",""))[:500],
            "link":getattr(e,"link","")
        })
    return out

def ai_make(topic, news, key, model):
    src="\n\n".join(
        f"[{i+1}] {x['title']}\n{x['summary']}\n{x['link']}" for i,x in enumerate(news)
    )
    prompt=f"""
너는 한국 인스타그램 뉴스 카드 제작자다.
사용자 소재: {topic}

아래 최신 검색 결과를 참고해서, 이미지 1장짜리 뉴스 카드에 들어갈 강한 헤드라인과 인스타 캡션을 만든다.

검색결과:
{src}

규칙:
- 헤드라인은 2~4줄로 끊기기 쉬운 24~42자 정도.
- 사실 범위를 넘지 말 것. 없는 숫자/날짜/인용 만들지 말 것.
- 낚시성 거짓 표현 금지.
- 캡션은 핵심 내용 4~7문장 + 마지막 저장/팔로우 CTA.
- 해시태그 6~10개.
- source_title/source_url은 가장 핵심 출처 하나.
- JSON만 출력.

{{
 "headline":"...",
 "caption":"...",
 "hashtags":["#..."],
 "source_title":"...",
 "source_url":"...",
 "fact_note":"게시 전 꼭 확인할 포인트 1~2문장"
}}
"""
    c=OpenAI(api_key=key)
    r=c.responses.create(model=model,input=prompt)
    txt=getattr(r,"output_text","")
    m=re.search(r"\{.*\}",txt,re.S)
    if not m: raise ValueError("AI 응답 형식 오류")
    return json.loads(m.group(0))

def wrap(draw,text,font,maxw):
    words=str(text).split()
    lines=[]; cur=""
    for w in words:
        t=(cur+" "+w).strip()
        box=draw.textbbox((0,0),t,font=font)
        if box[2]-box[0] <= maxw:
            cur=t
        else:
            if cur: lines.append(cur)
            cur=w
    if cur: lines.append(cur)
    return lines

def make_card(headline, bg=None, source=""):
    W,H=1080,1350
    if bg is None:
        im=Image.new("RGB",(W,H),(34,36,42))
        d=ImageDraw.Draw(im)
        for y in range(H):
            v=int(32+28*y/H)
            d.line((0,y,W,y),fill=(v,v,v+5))
    else:
        im=ImageOps.fit(bg.convert("RGB"),(W,H),method=Image.Resampling.LANCZOS)
        im=im.filter(ImageFilter.GaussianBlur(radius=1.2))

    # dark overlay
    overlay=Image.new("RGBA",(W,H),(0,0,0,0))
    od=ImageDraw.Draw(overlay)
    od.rectangle((0,0,W,H),fill=(0,0,0,80))
    od.rectangle((0,780,W,H),fill=(0,0,0,165))
    im=Image.alpha_composite(im.convert("RGBA"),overlay).convert("RGB")
    d=ImageDraw.Draw(im)

    # small source label top
    d.rounded_rectangle((55,55,260,112),radius=18,fill=(245,245,245))
    d.text((78,69),"오늘의 핵심",font=fnt(27,True),fill=(20,20,20))

    # Headline block
    hf=fnt(68,True)
    lines=wrap(d,headline,hf,930)
    y=835
    for line in lines[:4]:
        # shadow
        d.text((70+3,y+3),line,font=hf,fill=(0,0,0))
        d.text((70,y),line,font=hf,fill=(255,255,255))
        y+=86

    # accent line
    d.rounded_rectangle((70,790,210,804),radius=7,fill=(255,215,55))

    # footer/source
    src = source[:65] if source else "출처 확인 후 게시"
    d.text((70,1270),src,font=fnt(24,False),fill=(225,225,225))
    return im

st.title("📰 원카드 뉴스 메이커")
st.caption("소재 한 줄 → 최신 기사 확인 → 헤드라인/캡션 → 인스타용 이미지 1장")

with st.expander("설정", expanded=False):
    api_key=st.text_input("OpenAI API Key",value=os.getenv("OPENAI_API_KEY",""),type="password")
    model=st.text_input("모델",value=os.getenv("OPENAI_MODEL","gpt-5.6"))
    st.caption("API 키는 브라우저 세션에서만 사용됩니다.")

topic=st.text_area("소재",placeholder="예: 정부가 청년 지원금 제도를 확대했다",height=110)
bg_file=st.file_uploader("배경사진(선택)",type=["jpg","jpeg","png","webp"])
st.caption("뉴스사 사진을 무단으로 쓰지 말고, 직접 만든 이미지나 사용권이 있는 사진을 쓰세요.")

if st.button("✨ 카드 만들기"):
    if not topic.strip():
        st.error("소재를 입력해주세요.")
    elif not api_key:
        st.error("설정에서 OpenAI API Key를 입력해주세요.")
    else:
        try:
            with st.spinner("관련 기사 확인 + 문구 생성 중..."):
                news=news_search(topic.strip())
                data=ai_make(topic.strip(),news,api_key,model)
                st.session_state["result"]=data
                st.session_state["news"]=news
        except Exception as e:
            st.error(str(e))

data=st.session_state.get("result")
if data:
    st.markdown("### 생성 결과")
    headline=st.text_area("헤드라인",value=data.get("headline",""),height=100)
    caption=st.text_area("캡션",value=data.get("caption",""),height=180)
    tags=" ".join(data.get("hashtags",[]))
    st.text_area("해시태그",value=tags,height=80)
    st.warning("팩트체크: "+data.get("fact_note",""))

    bg=None
    if bg_file:
        bg=Image.open(bg_file)
    card=make_card(headline,bg,data.get("source_title",""))
    st.image(card,use_container_width=True)

    b=io.BytesIO()
    card.save(b,format="PNG",optimize=True)
    st.download_button("📥 PNG 저장",b.getvalue(),file_name="instagram_news_card.png",mime="image/png")

    txt=f"""{caption}

{tags}

출처: {data.get('source_title','')}
{data.get('source_url','')}
"""
    st.download_button("📄 캡션 TXT 저장",txt,file_name="caption.txt",mime="text/plain")

    with st.expander("참고 기사"):
        for x in st.session_state.get("news",[]):
            st.write("• "+x["title"])
            st.caption(x["link"])
