import pygame
import random

pygame.init()

width, height = 800, 600
screen = pygame.display.set_mode((width, height))
pygame.display.set_caption("문장 완성하기 (Dialogue Builder)")

white = (245, 245, 245)
black = (40, 40, 40)
blue = (70, 130, 180)
gray = (200, 200, 200)
green = (46, 139, 87)
red = (200, 60, 60)

def get_korean_font(size, bold=False):
    font_candidates = [
        "Apple SD Gothic Neo", "NanumGothic", "Arial Unicode MS", "Arial", None
    ]
    for name in font_candidates:
        try:
            return pygame.font.SysFont(name, size, bold=bold)
        except:
            continue
    return pygame.font.SysFont(None, size, bold=bold)

big_font = get_korean_font(54, bold=True)
med_font = get_korean_font(32)
small_font = get_korean_font(24)

sentences = [
    ("저는 ___ 주세요.", ["물", "밥", "음악", "친구"], "물"),
    ("당신은 제 ___가 되어줄 수 있나요?", ["친구", "책", "학교", "행복"], "친구"),
    ("오늘 ___가 정말 좋아요.", ["날씨", "음악", "밥", "책"], "날씨"),
    ("저는 지금 ___에 가요.", ["학교", "친구", "행복", "물"], "학교"),
    ("저는 ___을(를) 사랑해요!", ["음악", "책", "밥", "친구"], "음악"),
    ("함께 ___을(를) 읽어요.", ["책", "학교", "날씨", "행복"], "책"),
    ("___이(가) 저를 행복하게 해요.", ["행복", "밥", "친구", "음악"], "행복"),
    ("___ 좀 드실래요?", ["밥", "책", "학교", "날씨"], "밥"),
    ("___이(가) 제일 좋아하는 과목이에요.", ["음악", "친구", "행복", "날씨"], "음악"),
    ("좋은 ___은(는) 영원해요.", ["친구", "책", "학교", "밥"], "친구"),
]

random.shuffle(sentences)
current = 0
score = 0
selected = None
show_result = False
result_text = ""
result_color = black
game_over = False

clock = pygame.time.Clock()

def draw_sentence(sentence, options, selected_idx=None, correct=None):
    screen.fill(white)
    title = big_font.render("문장을 완성하세요!", True, blue)
    screen.blit(title, (width//2 - title.get_width()//2, 40))
    srf = med_font.render(sentence, True, black)
    screen.blit(srf, (width//2 - srf.get_width()//2, 140))
    btns = []
    total_btn_width = len(options) * 140 + (len(options)-1)*20
    start_x = width//2 - total_btn_width//2
    for i, word in enumerate(options):
        x = start_x + i*160
        y = 260
        color = gray
        if selected_idx == i:
            color = blue if correct is None else (green if correct else red)
        pygame.draw.rect(screen, color, (x, y, 140, 70), border_radius=16)
        w_srf = med_font.render(word, True, white if selected_idx == i else black)
        screen.blit(w_srf, (x+70-w_srf.get_width()//2, y+35-w_srf.get_height()//2))
        btns.append(pygame.Rect(x, y, 140, 70))
    return btns

def draw_result(text, color):
    srf = med_font.render(text, True, color)
    screen.blit(srf, (width//2 - srf.get_width()//2, 370))

def draw_game_over(score, total):
    screen.fill(white)
    s1 = big_font.render("게임 종료!", True, blue)
    s2 = med_font.render(f"점수: {score} / {total}", True, black)
    s3 = small_font.render("스페이스바: 다시하기   ESC: 종료", True, black)
    screen.blit(s1, (width//2 - s1.get_width()//2, 160))
    screen.blit(s2, (width//2 - s2.get_width()//2, 250))
    screen.blit(s3, (width//2 - s3.get_width()//2, 340))

def reset_game():
    global current, score, selected, show_result, result_text, result_color, game_over
    random.shuffle(sentences)
    current = 0
    score = 0
    selected = None
    show_result = False
    result_text = ""
    result_color = black
    game_over = False

running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        if game_over:
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    reset_game()
                if event.key == pygame.K_ESCAPE:
                    running = False
            continue
        if not game_over and event.type == pygame.MOUSEBUTTONDOWN and event.button == 1 and not show_result:
            mouse = pygame.mouse.get_pos()
            sentence, options, answer = sentences[current]
            btns = draw_sentence(sentence, options)
            for i, rect in enumerate(btns):
                if rect.collidepoint(mouse):
                    selected = i
                    show_result = True
                    if options[i] == answer:
                        score += 1
                        result_text = "정답입니다!"
                        result_color = green
                    else:
                        result_text = f"오답! 정답: {answer}"
                        result_color = red
                    pygame.time.set_timer(pygame.USEREVENT, 900)
        if event.type == pygame.USEREVENT and show_result:
            show_result = False
            selected = None
            pygame.time.set_timer(pygame.USEREVENT, 0)
            current += 1
            if current >= len(sentences):
                game_over = True

    if game_over:
        draw_game_over(score, len(sentences))
    else:
        sentence, options, answer = sentences[current]
        btns = draw_sentence(sentence, options, selected, None if not show_result else (options[selected]==answer))
        if show_result:
            draw_result(result_text, result_color)

    pygame.display.flip()
    clock.tick(60)