# i made this in pygame and asked ai to translate it into js react typescript later + integrate
# 
# premise of the game...
# aight so this is simple, based on conversation with user, ai will make a set of flashcards in target language to learn,
# and user will have to flip them to see the meaning, and then type in the meaning to confirm they learned it.
# if they get it right, they get a point, if they get it wrong, they see the correct answer and move on.
# at the end of the game, they see their score and can choose to play again or exit.
# not really a game but it is a minigame for learning vocabulary.

import pygame

pygame.init()

width = 800
height = 600
screen = pygame.display.set_mode((width, height))
pygame.display.set_caption("Flashcard Flip")

white = (255, 255, 255)
black = (30, 30, 30)
blue = (70, 130, 180)

big_font = pygame.font.SysFont("malgungothic", 54)
medium_font = pygame.font.SysFont("malgungothic", 32)
small_font = pygame.font.SysFont("malgungothic", 24)

# ngl idk if this is right i just asked google translate
flashcards = [
    ("안녕하세요", "annyeonghaseyo", "Hello"),
    ("감사합니다", "gamsahamnida", "Thank you"),
    ("미안합니다", "mianhamnida", "I'm sorry"),
    ("네", "ne", "Yes"),
    ("아니요", "aniyo", "No"),
    ("사랑해요", "saranghaeyo", "I love you"),
    ("맛있어요", "masisseoyo", "It's delicious"),
    ("물", "mul", "Water"),
    ("밥", "bap", "Rice/Food"),
    ("친구", "chingu", "Friend"),
]

current = 0
score = 0
flipped = False
user_input = ""
result = None
result_time = 0
game_over = False

def reset_game():
    global current, score, flipped, user_input, result, result_time, game_over
    current = 0
    score = 0
    flipped = False
    user_input = ""
    result = None
    result_time = 0
    game_over = False

def check():
    global score, result, flipped, result_time
    answer = flashcards[current][2].lower().strip()
    guess = user_input.lower().strip()
    
    if guess == answer or answer in guess or guess in answer:
        score += 1
        result = "correct"
    else:
        result = "wrong"
    
    flipped = True
    result_time = pygame.time.get_ticks()

def next_card():
    global current, flipped, user_input, result, game_over
    current += 1
    flipped = False
    user_input = ""
    result = None
    
    if current >= len(flashcards):
        game_over = True

clock = pygame.time.Clock()
running = True

# main loop 
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        
        elif event.type == pygame.KEYDOWN:
            if game_over:
                if event.key == pygame.K_RETURN:
                    reset_game()
            
            elif result is None:
                if event.key == pygame.K_RETURN and user_input:
                    check()
                elif event.key == pygame.K_BACKSPACE:
                    user_input = user_input[:-1]
                elif event.unicode.isprintable() and len(user_input) < 25:
                    user_input += event.unicode
        
        elif event.type == pygame.MOUSEBUTTONDOWN and game_over:
            mouse = pygame.mouse.get_pos()
            btn_x = (width - 140) // 2
            btn_y = 340
            if btn_x <= mouse[0] <= btn_x + 140 and btn_y <= mouse[1] <= btn_y + 45:
                reset_game()
        
        elif event.type == pygame.MOUSEBUTTONDOWN and not game_over and result is None:
            mouse = pygame.mouse.get_pos()
            btn_x = (width - 120) // 2
            btn_y = 410
            if btn_x <= mouse[0] <= btn_x + 120 and btn_y <= mouse[1] <= btn_y + 40:
                if user_input:
                    check()
    
    if result and pygame.time.get_ticks() - result_time > 1500:
        next_card()
    
    screen.fill(white)
    
    if game_over:
        pct = int((score / len(flashcards)) * 100)
        
        title = big_font.render(f"{score} / {len(flashcards)}", True, black)
        screen.blit(title, title.get_rect(center=(width // 2, 200)))
        
        pct_text = medium_font.render(f"{pct}%", True, blue)
        screen.blit(pct_text, pct_text.get_rect(center=(width // 2, 270)))
        
        btn_x = (width - 140) // 2
        btn_y = 340
        pygame.draw.rect(screen, blue, (btn_x, btn_y, 140, 45), border_radius=8)
        btn_text = medium_font.render("Again", True, white)
        screen.blit(btn_text, btn_text.get_rect(center=(btn_x + 70, btn_y + 22)))
    
    else:
        progress = small_font.render(f"{current + 1}/{len(flashcards)}", True, black)
        screen.blit(progress, (30, 25))
        
        score_text = small_font.render(f"{score}", True, blue)
        screen.blit(score_text, score_text.get_rect(topright=(width - 30, 25)))
        
        card = flashcards[current]
        card_x = (width - 480) // 2
        card_y = 100
        
        pygame.draw.rect(screen, blue if not flipped else black, (card_x, card_y, 480, 200), border_radius=12)
        
        if not flipped:
            korean = big_font.render(card[0], True, white)
            screen.blit(korean, korean.get_rect(center=(width // 2, card_y + 80)))
            
            roman = small_font.render(card[1], True, white)
            screen.blit(roman, roman.get_rect(center=(width // 2, card_y + 140)))
        else:
            english = big_font.render(card[2], True, white)
            screen.blit(english, english.get_rect(center=(width // 2, card_y + 100)))
        
        if result is None:
            box_x = (width - 350) // 2
            box_y = 340
            
            input_text = medium_font.render(user_input + "|" if pygame.time.get_ticks() % 1000 < 500 else user_input, True, black)
            screen.blit(input_text, input_text.get_rect(center=(width // 2, box_y + 20)))
            
            btn_x = (width - 120) // 2
            btn_y = 410
            pygame.draw.rect(screen, blue, (btn_x, btn_y, 120, 40), border_radius=8)
            btn_text = small_font.render("Check", True, white)
            screen.blit(btn_text, btn_text.get_rect(center=(btn_x + 60, btn_y + 20)))
        else:
            if result == "correct":
                msg = medium_font.render("Correct", True, blue)
            else:
                msg = medium_font.render("Wrong", True, black)
            screen.blit(msg, msg.get_rect(center=(width // 2, 380)))
    
    pygame.display.flip()
    clock.tick(60)

pygame.quit()