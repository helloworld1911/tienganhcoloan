# Tạo file .docx mẫu (đề + đáp án) giống đề HSG Anh 6 để kiểm thử bộ phân tích.
import re, sys, os
from docx import Document

OUT = os.path.join(os.path.dirname(__file__), "fixtures")
os.makedirs(OUT, exist_ok=True)

def para(doc, text):
    """Thêm đoạn; phần trong [[...]] sẽ được gạch chân."""
    p = doc.add_paragraph()
    for chunk in re.split(r"(\[\[.*?\]\])", text):
        if not chunk:
            continue
        if chunk.startswith("[["):
            r = p.add_run(chunk[2:-2]); r.underline = True
        else:
            p.add_run(chunk)
    return p

doc = Document()
t = doc.add_table(rows=1, cols=2)
t.cell(0, 0).text = "PHÒNG GD&ĐT QUẢNG NINH\nĐỀ CHÍNH THỨC"
t.cell(0, 1).text = ("ĐỀ THI CHỌN HỌC SINH GIỎI CẤP HUYỆN\nNĂM HỌC 2024 – 2025\nMôn thi: TIẾNG ANH 6\n"
                     "Thời gian làm bài: 120 phút, không kể thời gian giao đề")
lines = r"""
SECTION I. LISTENING (20 pts)
Part 1. Listen to the recording and choose the circle the best option (A, B, C, or D) for the following statements and questions. (5 pts)
1. Where does the man want to go?
A. Tokyo Tower B. Tokyo Subway Station C. Tokyo Art Museum D. Tokyo Hotel
2. How much is the train fare?
A. 140 yen B. 130 yen C. 150 yen D. 170 yen
3. Where should the man get on the train?
A. platform number 3 B. platform number 1 C. platform number 5 D. platform number 4
4. How often do the trains come?
A. about every seven minutes B. about every five minutes
C. about every six minutes D. about every nine minutes
5. Where should the man get off the train?
A. at Kamiyacho Station B. at Kamigaya Station
C. at Kamiyama Station D. Kami Oragal Station
Part 2. Listen and decide whether the statements are True (T) or False (F). (5 pts)
6. When Randall’s children were little, he used to goes to bed early on New Year’s Eve.
7. Randall used to play games with friends to celebrate the new year.
8. Randall and his friends used to eat salad with a lot of vegetables in it on New Year’s Eve.
9. Now, Randall usually goes for a drive on New Year’s Eve.
10. Randall loves the simple of life.
Part 3. Listen and write the correct answer in the gap for each question (write on word or a number or a date or a time). (10 pts)
TABLE
SECTION II. PHONETICS (5 pts)
Part 1. Choose the word which has the underlined part pronounced differently from that of the rest by circling your answer (A, B, C, or D). (3 pts)
21. A. mass[[age]] B. carri[[age]] C. voy[[age]] D. dos[[age]]
22. A. b[[oo]]k B. f[[oo]]d C. c[[oo]]k D. l[[oo]]k
23. A. wash[[es]] B. match[[es]] C. wish[[es]] D. arriv[[es]]
Part 2. Choose the letter (A, B, C, or D) with the word whose main stress is placed differently from the others. (2 pts)
24. A. concert B. teenager C. comfortable D. cartoon
25. A. enjoy B. finish C. visit D. happen
SECTION 3. LEXICAL – GRAMMAR (30 pts)
Part 1. Choose the word or phrase (A, B, C, or D) which best completes each sentence. (10 pts)
26. Duong: “I’m hungry now, Mum!” – Mother: “____________”
A. Would you like to go out? B. Let’s cook dinner now.
C. Why are you so hungry? D. Here is some bread and butter for you.
27. All of us ____________ at home yesterday evening.
A. were B. was C. did D. are
28. Minh is an active and strong boy. He does ____________ karate twice a week.
A. a B. X C. the D. an
29. We have little time left. We will ____________ the last bus if you don’t hurry, boy.
A. take B. see C. miss D. catch
30. I am very thin. Why should I eat if I want to ____________ weight?
A. go off B. go on C. put off D. put on
Part 2. Put the verbs given in brackets into the appropriate tenses or forms. (5 pts)
36. I wish I (can) ____________ fly like a bird.
37. Look! A man (run) ____________ after the train.
38. It’s the first time I (eat) ____________ sushi.
Part 3. Fill in each blank with the correct preposition. (5 pts)
41. I will arrive at the airport ____________ 7 a.m. tomorrow.
42. I prefer tea ____________ coffee in the morning.
Part 4. Complete each sentence with appropriate form of the word in block capitals. (5 pts)
46. In Sweden, it is customary at a dinner party for the person sitting on the left of the hostess to make a ____________. (SPEAK)
48. Nobody likes him because of his ____________. (TIDY)
Part 5. There is ONE mistake in each sentence. Circle and correct it. (5 pts)
51. You should [[take]] [[regularly]] exercise [[in order to]] stay [[healthy]].
A B C D
52. [[Stay]] far [[from]] sweets because [[they’re]] not good [[for]] your teeth.
A B C D
SECTION 4. READING COMPREHENSION (20 pts)
Part 1. Complete the passage with the missing words. Use only ONE word in each gap. (10 pts)
There are many beautiful cities (56) ____________ the world, each with its own unique culture and history. Some cities are famous (57) ____________ their modern buildings, while others are known for their historical landmarks (58) ____________ traditions.
One of the (59) ____________ famous cities in the world is Paris, the capital of (60) ____________.
Part 2. Read the following passage and choose the best option to answer. (1.0 pt)
School of the Air
Many of us may be surprised to hear the name “School of the air”, but there are over ten of them in Australia. Alice Springs School of the Air is one of these in the Northern Territory.
Students of this school live far from each other, so they don't have normal lessons in classrooms, but they study at their homes.
66. How many “Schools of the Air” are there in Australia?
A. One B. More than ten C. About twenty D. Over a hundred
67. Where is Alice Springs School of the Air located?
A. In Southern Australia B. In Western Australia
C. In the Northern Territory D. In New South Wales
SECTION 5. WRITING
Part 1. Finish each of the following sentences in such a way that it means exactly the same as the sentences printed before it. (5 pts)
76. Do you find it easy to make friends?
→ Are you good
80. Why don’t you go to Sydney with our class?
→ How about
Part 2. Use the given word to write the second sentence in such a way that it is as similar as possible in meaning to the original sentence. Do not change the form of the given word. You must use between TWO and FIVE words, including the word given. (5 pts)
81. It’s a long time since I saw him. (FOR)
→ I ______________ a long time.
84. Although he was tired, he continued working. (DESPITE)
→ ______________, he continued working.
Part 3. Using the given words to complete these sentences (CAN CHANGE THE WORDS GIVEN BUT DO NOT DELETE). (5 pts)
86. This/ be/ the most interesting book/ I/ ever/ read.
→
87. Unless/ you/ study/ hard, you/ not/ pass/ exam.
→
Part 4. Read the letter Tom sent to Anna:
Hi Anna,
I hope you’re doing well! For me, I watch it almost every day because I find it very useful and interesting.
How about you? Do you like it? Why do/ don’t you like it?
Tom
Imagine that you are Anna and write an email in English of about 80 words to reply to Tom’s email. (10 pts)
THE END
"""
for line in lines.strip().split("\n"):
    if line == "TABLE":
        tb = doc.add_table(rows=4, cols=2)
        rows = [("Redlands Music Festival", ""), ("Starts on:", "(11) ____________ August"),
                ("Finish:", "(12) ____________ August"), ("Place:", "Prospect Park, (13) ____________ Redlands")]
        for i, (a, b) in enumerate(rows):
            tb.cell(i, 0).text = a; tb.cell(i, 1).text = b
        continue
    para(doc, line)
doc.save(os.path.join(OUT, "de-hsg-anh6.docx"))

# ---- Đáp án: bảng ngang cho phần trắc nghiệm + dòng cho phần tự luận
key = Document()
key.add_paragraph("ĐÁP ÁN ĐỀ THI HSG ANH 6")
key.add_paragraph("SECTION I. LISTENING")
tb = key.add_table(rows=2, cols=6)
for i, (n, a) in enumerate([("Câu", "Đáp án"), ("1", "C"), ("2", "A"), ("3", "B"), ("4", "B"), ("5", "A")]):
    tb.cell(0, i).text = n; tb.cell(1, i).text = a
key.add_paragraph("6. F  7. T  8. F  9. T  10. T")
key.add_paragraph("11. 14th  12. 16th  13. North  14. 0472-555-112")
for s in ["21. D", "22. B (food /uː/, các từ còn lại /ʊ/)", "23. D", "24. D", "25. A",
          "26. D", "27. A", "28. B", "29. C", "30. D",
          "36. could", "37. is running", "38. have eaten / have ever eaten", "41. at", "42. to",
          "46. speech", "48. untidiness",
          "51. B (regularly → regular)", "52. A (Stay → Keep)",
          "56. in/ around", "57. for", "58. and", "59. most", "60. France",
          "66. B", "67. C",
          "76. Are you good at making friends?", "80. How about going to Sydney with our class?",
          "81. haven't seen him for", "84. Despite being tired",
          "86. This is the most interesting book I have ever read.",
          "87. Unless you study hard, you will not pass the exam. | Unless you study hard, you won't pass the exam."]:
    key.add_paragraph(s)
key.save(os.path.join(OUT, "dap-an-hsg-anh6.docx"))
print("ok")
