# ok so i followed brad's flashcard file and made a matching game
# pygame is not my strong suit lol but i got it working
# i made the logo from canva
# and then i used ai to put it into react

import pygame
import random

pygame.init()

WIDTH, HEIGHT = 800, 600
SCREEN = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("✨ Word Match Master ✨")

WHITE    = (245, 245, 245)
BLACK    = (40, 40, 40)
BLUE     = (70, 130, 180)
GREEN    = (46, 139, 87)
GRAY     = (200, 200, 200)
HIGHLIGHT = (200, 230, 255)

BIG_FONT = pygame.font.SysFont("malgungothic", 64, bold=True)
MED_FONT = pygame.font.SysFont("malgungothic", 28)

WORD_PAIRS = [
    ("물", "Water"), ("밥", "Rice"), ("친구", "Friend"),
    ("사랑", "Love"), ("책", "Book"), ("학교", "School"),
    ("음악", "Music"), ("시간", "Time"), ("날씨", "Weather"),
    ("행복", "Happiness"),
]

def setup_game():
    left_list = [p[0] for p in WORD_PAIRS]
    right_list = [p[1] for p in WORD_PAIRS]
    random.shuffle(left_list)
    random.shuffle(right_list)
  
    left_rects = []
    right_rects = []
    for i in range(len(left_list)):
        left_rects.append(pygame.Rect(100, 100 + i * 45, 200, 40))
        right_rects.append(pygame.Rect(500, 100 + i * 45, 200, 40))
        
    return left_list, right_list, left_rects, right_rects

left_words, right_words, left_rects, right_rects = setup_game()
selected_left = None
selected_right = None 
matched_left = []    
matched_right = []   
score = 0

running = True
clock = pygame.time.Clock()

while running:
    mouse_pos = pygame.mouse.get_pos()
    
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
            
        if event.type == pygame.MOUSEBUTTONDOWN and len(matched_left) < len(WORD_PAIRS):
           
            for i, rect in enumerate(left_rects):
                if rect.collidepoint(mouse_pos) and i not in matched_left:
                    selected_left = i
            
            for i, rect in enumerate(right_rects):
                if rect.collidepoint(mouse_pos) and i not in matched_right:
                    selected_right = i

            if selected_left is not None and selected_right is not None:
                korean = left_words[selected_left]
                english = right_words[selected_right]
                
                if (korean, english) in WORD_PAIRS:
                    matched_left.append(selected_left)
                    matched_right.append(selected_right)
                    score += 10
                
                selected_left = None
                selected_right = None

    SCREEN.fill(WHITE)
    
    for i in range(len(matched_left)):
        l_idx = matched_left[i]
        r_idx = matched_right[i]
        pygame.draw.line(SCREEN, GREEN, left_rects[l_idx].midright, right_rects[r_idx].midleft, 3)

    def draw_column(words, rects, selected_idx, matched_indices):
        for i, (word, rect) in enumerate(zip(words, rects)):
            color = BLACK
            bg_color = WHITE
            if i in matched_indices:
                color = GRAY
                bg_color = GRAY  
            elif i == selected_idx:
                color = BLUE
                bg_color = HIGHLIGHT
            elif rect.collidepoint(mouse_pos):
                bg_color = (240, 240, 240)
            pygame.draw.rect(SCREEN, bg_color, rect, border_radius=5) 
            pygame.draw.rect(SCREEN, BLUE, rect, 2, border_radius=5)  
            txt = MED_FONT.render(word, True, color)
            SCREEN.blit(txt, (rect.x + 10, rect.y + 2))

    draw_column(left_words, left_rects, selected_left, matched_left)
    draw_column(right_words, right_rects, selected_right, matched_right)

    score_txt = MED_FONT.render(f"Score: {score}", True, GREEN)
    SCREEN.blit(score_txt, (350, 20))

    if len(matched_left) == len(WORD_PAIRS):
        overlay = pygame.Surface((WIDTH, HEIGHT), pygame.SRCALPHA)
        overlay.fill((255, 255, 255, 200))
        SCREEN.blit(overlay, (0,0))
        
        over_txt = BIG_FONT.render("EXCELLENT!", True, GREEN)
        SCREEN.blit(over_txt, (WIDTH//2 - 180, HEIGHT//2 - 50))
        retry_txt = MED_FONT.render("All words matched!", True, BLACK)
        SCREEN.blit(retry_txt, (WIDTH//2 - 130, HEIGHT//2 + 30))

    pygame.display.flip()
    clock.tick(60)

pygame.quit()