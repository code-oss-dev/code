FasdUAS 1.101.10   ��   ��    k             l     ��  ��    C =-------------------------------------------------------------     � 	 	 z - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -   
  
 l     ��  ��    @ : Copyright (C) Microsoft Corporation. All rights reserved.     �   t   C o p y r i g h t   ( C )   M i c r o s o f t   C o r p o r a t i o n .   A l l   r i g h t s   r e s e r v e d .      l     ��  ��    C =-------------------------------------------------------------     �   z - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -      l     ��������  ��  ��        l     ��  ��    e _ the following two properties are persisted across different runs of this TerminalHelper script     �   �   t h e   f o l l o w i n g   t w o   p r o p e r t i e s   a r e   p e r s i s t e d   a c r o s s   d i f f e r e n t   r u n s   o f   t h i s   T e r m i n a l H e l p e r   s c r i p t      l     ��  ��    B < they are used to reuse the same terminal across invocations     �   x   t h e y   a r e   u s e d   t o   r e u s e   t h e   s a m e   t e r m i n a l   a c r o s s   i n v o c a t i o n s     !   j     �� "�� 0 lasttty lastTty " m     ��
�� 
msng !  # $ # j    �� %�� 0 lastwindowid lastWindowID % m    ��
�� 
msng $  & ' & l     ��������  ��  ��   '  ( ) ( i    	 * + * I     �� ,��
�� .aevtoappnull  �   � **** , o      ���� 0 argv  ��   + k    � - -  . / . l     ��������  ��  ��   /  0 1 0 r      2 3 2 m     ��
�� 
msng 3 o      ���� 0 window_title   1  4 5 4 r     6 7 6 m    ��
�� 
msng 7 o      ���� 0 working_dir   5  8 9 8 r     : ; : m    	 < < � = =   ; o      ���� 0 programargs programArgs 9  > ? > r     @ A @ m     B B � C C   A o      ���� 0 env_vars   ?  D E D l   ��������  ��  ��   E  F G F Y    � H�� I J�� H k    � K K  L M L r    $ N O N l   " P���� P n    " Q R Q 4    "�� S
�� 
cobj S o     !���� 0 i   R o    ���� 0 argv  ��  ��   O o      ���� 0 a   M  T U T l  % %��������  ��  ��   U  V W V Z   % � X Y Z�� X =   % ( [ \ [ o   % &���� 0 a   \ m   & ' ] ] � ^ ^  - w Y k   + 9 _ _  ` a ` r   + 0 b c b [   + . d e d o   + ,���� 0 i   e m   , -����  c o      ���� 0 i   a  f�� f r   1 9 g h g n   1 7 i j i 1   5 7��
�� 
strq j l  1 5 k���� k n   1 5 l m l 4   2 5�� n
�� 
cobj n o   3 4���� 0 i   m o   1 2���� 0 argv  ��  ��   h o      ���� 0 working_dir  ��   Z  o p o =   < ? q r q o   < =���� 0 a   r m   = > s s � t t  - a p  u v u k   B T w w  x y x r   B G z { z [   B E | } | o   B C���� 0 i   } m   C D����  { o      ���� 0 i   y  ~�� ~ r   H T  �  b   H R � � � b   H K � � � o   H I���� 0 programargs programArgs � m   I J � � � � �    � n   K Q � � � 1   O Q��
�� 
strq � l  K O ����� � n   K O � � � 4   L O�� �
�� 
cobj � o   M N���� 0 i   � o   K L���� 0 argv  ��  ��   � o      ���� 0 programargs programArgs��   v  � � � =   W Z � � � o   W X���� 0 a   � m   X Y � � � � �  - e �  � � � k   ] o � �  � � � r   ] b � � � [   ] ` � � � o   ] ^���� 0 i   � m   ^ _����  � o      ���� 0 i   �  ��� � r   c o � � � b   c m � � � b   c f � � � o   c d���� 0 env_vars   � m   d e � � � � �    � n   f l � � � 1   j l��
�� 
strq � l  f j ����� � n   f j � � � 4   g j�� �
�� 
cobj � o   h i���� 0 i   � o   f g���� 0 argv  ��  ��   � o      ���� 0 env_vars  ��   �  � � � =   r w � � � o   r s���� 0 a   � m   s v � � � � �  - t �  ��� � k   z � � �  � � � r   z  � � � [   z } � � � o   z {���� 0 i   � m   { |����  � o      ���� 0 i   �  ��� � r   � � � � � l  � � ����� � n   � � � � � 4   � ��� �
�� 
cobj � o   � ����� 0 i   � o   � ����� 0 argv  ��  ��   � o      ���� 0 window_title  ��  ��  ��   W  ��� � l  � ���������  ��  ��  ��  �� 0 i   I m    ����  J l    ����� � I   �� ���
�� .corecnte****       **** � o    ���� 0 argv  ��  ��  ��  ��   G  � � � l  � ���������  ��  ��   �  � � � r   � � � � � m   � � � � � � �   � o      ���� 0 cmd   �  � � � Z   � � � ����� � >   � � � � � o   � ����� 0 working_dir   � m   � ���
�� 
msng � r   � � � � � b   � � � � � b   � � � � � m   � � � � � � �  c d   � o   � ����� 0 working_dir   � m   � � � � � � �  ;   � o      ���� 0 cmd  ��  ��   �  � � � l  � ���������  ��  ��   �  � � � Z   � � � ����� � >   � � � � � o   � ����� 0 env_vars   � m   � � � � � � �   � r   � � � � � b   � � � � � b   � � � � � o   � ����� 0 cmd   � m   � � � � � � �  e n v � o   � ����� 0 env_vars   � o      ���� 0 cmd  ��  ��   �  � � � l  � ���������  ��  ��   �  � � � Z   � � � ����� � >   � � � � � o   � ����� 0 programargs programArgs � m   � � � � � � �   � r   � � � � � b   � � � � � o   � ��� 0 cmd   � o   � ��~�~ 0 programargs programArgs � o      �}�} 0 cmd  ��  ��   �  � � � l  � ��|�{�z�|  �{  �z   �  � � � O   �� �  � k   ��  l  � ��y�x�w�y  �x  �w    r   � � n  � �	 I   � ��v
�u�v &0 findnonbusyttytab findNonBusyTtyTab
  o   � ��t�t 0 lastwindowid lastWindowID �s o   � ��r�r 0 lasttty lastTty�s  �u  	  f   � � o      �q�q 0 	targettab 	targetTab  l  � ��p�o�n�p  �o  �n    Z   ���m >   � o   � ��l�l 0 	targettab 	targetTab m   ��k
�k 
null k    l �j�j     reuse terminal    �    r e u s e   t e r m i n a l  l  ! r  "#" m  �i
�i boovtrue# n      $%$ 1  
�h
�h 
tbsl% o  
�g�g 0 	targettab 	targetTab    bring tab to front   ! �&& &   b r i n g   t a b   t o   f r o n t '�f' I �e()
�e .coredoscnull��� ��� ctxt( o  �d�d 0 cmd  ) �c*�b
�c 
kfil* o  �a�a 0 	targettab 	targetTab�b  �f  �m   k   �++ ,-, l   �`./�`  .   create new terminal   / �00 (   c r e a t e   n e w   t e r m i n a l- 121 r   +343 l  '5�_�^5 I  '�]6�\
�] .coredoscnull��� ��� ctxt6 o   #�[�[ 0 cmd  �\  �_  �^  4 o      �Z�Z 0 	targettab 	targetTab2 787 l ,,�Y�X�W�Y  �X  �W  8 9:9 l ,,�V;<�V  ; . ( remember tty and window ID for next run   < �== P   r e m e m b e r   t t y   a n d   w i n d o w   I D   f o r   n e x t   r u n: >?> r  ,9@A@ l ,3B�U�TB n  ,3CDC 1  /3�S
�S 
tttyD o  ,/�R�R 0 	targettab 	targetTab�U  �T  A o      �Q�Q 0 lasttty lastTty? EFE r  :HGHG n :DIJI I  ;D�PK�O�P 0 window_of_tab  K L�NL o  ;@�M�M 0 lasttty lastTty�N  �O  J  f  :;H o      �L�L 0 	thewindow 	theWindowF MNM Z  IkOP�K�JO >  IPQRQ o  IL�I�I 0 	thewindow 	theWindowR m  LO�H
�H 
nullP r  SgSTS n  SaUVU 1  ]a�G
�G 
ID  V n S]WXW I  T]�FY�E�F 0 window_of_tab  Y Z�DZ o  TY�C�C 0 lasttty lastTty�D  �E  X  f  STT o      �B�B 0 lastwindowid lastWindowID�K  �J  N [\[ l ll�A�@�?�A  �@  �?  \ ]�>] Z  l�^_�=�<^ >  lo`a` o  lm�;�; 0 window_title  a m  mn�:
�: 
msng_ k  r�bb cdc r  r{efe m  rs�9
�9 boovtruef n      ghg 1  vz�8
�8 
tdcth o  sv�7�7 0 	targettab 	targetTabd iji r  |�klk m  |}�6
�6 boovfalsl n      mnm 1  ���5
�5 
tdspn o  }��4�4 0 	targettab 	targetTabj opo l ���3qr�3  q : 4set title displays device name of targetTab to false   r �ss h s e t   t i t l e   d i s p l a y s   d e v i c e   n a m e   o f   t a r g e t T a b   t o   f a l s ep t�2t r  ��uvu o  ���1�1 0 window_title  v n      wxw 1  ���0
�0 
titlx o  ���/�/ 0 	targettab 	targetTab�2  �=  �<  �>   y�.y l ���-�,�+�-  �,  �+  �.    m   � �zz�                                                                                      @ alis    N  HD                         Η��H+  ξ�Terminal.app                                                   �
�P�U        ����  	                	Utilities     Η��      �P�5    ξ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��   � {|{ l ���*�)�(�*  �)  �(  | }~} L  �� m  ���'�'  ~ ��&� l ���%�$�#�%  �$  �#  �&   ) ��� l     �"�!� �"  �!  �   � ��� i   
 ��� I      ���� &0 findnonbusyttytab findNonBusyTtyTab� ��� o      �� 0 awindow aWindow� ��� o      �� 0 atty aTty�  �  � k     b�� ��� O     _��� X    ^���� k    Y�� ��� r    ��� n    ��� 1    �
� 
ID  � o    �� 0 currentwindow currentWindow� o      �� 0 thewindowid theWindowId� ��� Z    Y����� =    ��� o    �� 0 thewindowid theWindowId� o    �� 0 awindow aWindow� X   " U���� k   4 P�� ��� r   4 9��� n   4 7��� 1   5 7�
� 
ttty� o   4 5�� 0 
currenttab 
currentTab� o      �� 0 thetty theTty� ��� Z   : P����� F   : G��� l  : =��
�	� =   : =��� o   : ;�� 0 thetty theTty� o   ; <�� 0 atty aTty�
  �	  � l  @ E���� >  @ E��� n   @ C��� 1   A C�
� 
busy� o   @ A�� 0 
currenttab 
currentTab� m   C D�
� boovtrue�  �  � L   J L�� o   J K�� 0 
currenttab 
currentTab�  �  �  � 0 
currenttab 
currentTab� n   % (��� 2  & (� 
�  
ttab� o   % &���� 0 currentwindow currentWindow�  �  �  � 0 currentwindow currentWindow� 2   
��
�� 
cwin� m     ���                                                                                      @ alis    N  HD                         Η��H+  ξ�Terminal.app                                                   �
�P�U        ����  	                	Utilities     Η��      �P�5    ξ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��  � ���� L   ` b�� m   ` a��
�� 
null��  � ��� l     ��������  ��  ��  � ��� i    ��� I      ������� 0 window_of_tab  � ���� o      ���� 0 atty aTty��  ��  � k     H�� ��� O     E��� X    D����� X    ?����� k   ( :�� ��� r   ( -��� n   ( +��� 1   ) +��
�� 
ttty� o   ( )���� 0 
currenttab 
currentTab� o      ���� 0 thetty theTty� ���� Z   . :������� l  . 1������ =   . 1��� o   . /���� 0 thetty theTty� o   / 0���� 0 atty aTty��  ��  � L   4 6�� o   4 5���� 0 currentwindow currentWindow��  ��  ��  �� 0 
currenttab 
currentTab� n    ��� 2   ��
�� 
ttab� o    ���� 0 currentwindow currentWindow�� 0 currentwindow currentWindow� 2   
��
�� 
cwin� m     ���                                                                                      @ alis    N  HD                         Η��H+  ξ�Terminal.app                                                   �
�P�U        ����  	                	Utilities     Η��      �P�5    ξ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��  � ���� L   F H�� m   F G��
�� 
null��  � ��� l     ��������  ��  ��  � ���� l     ��������  ��  ��  ��       ������������  � ������������ 0 lasttty lastTty�� 0 lastwindowid lastWindowID
�� .aevtoappnull  �   � ****�� &0 findnonbusyttytab findNonBusyTtyTab�� 0 window_of_tab  
�� 
msng
�� 
msng� �� +��������
�� .aevtoappnull  �   � ****�� 0 argv  ��  � ������ 0 argv  �� 0 i  � &������ <�� B�������� ]�� s � � � � ��� � � � � �z��������������������������
�� 
msng�� 0 window_title  �� 0 working_dir  �� 0 programargs programArgs�� 0 env_vars  
�� .corecnte****       ****
�� 
cobj�� 0 a  
�� 
strq�� 0 cmd  �� &0 findnonbusyttytab findNonBusyTtyTab�� 0 	targettab 	targetTab
�� 
null
�� 
tbsl
�� 
kfil
�� .coredoscnull��� ��� ctxt
�� 
ttty�� 0 window_of_tab  �� 0 	thewindow 	theWindow
�� 
ID  
�� 
tdct
�� 
tdsp
�� 
titl����E�O�E�O�E�O�E�O �k�j kh ��/E�O��  �kE�O��/�,E�Y P��  �kE�O��%��/�,%E�Y 5��  �kE�O��%��/�,%E�Y �a   �kE�O��/E�Y hOP[OY��Oa E` O�� a �%a %E` Y hO�a  _ a %�%E` Y hO�a  _ �%E` Y hOa  �)b  b   l+ E` O_ a  e_ a ,FO_ a _ l Y u_ j E` O_ a ,Ec   O)b   k+  E` !O_ !a  )b   k+  a ",Ec  Y hO�� "e_ a #,FOf_ a $,FO�_ a %,FY hOPUOjOP� ������������� &0 findnonbusyttytab findNonBusyTtyTab�� ����� �  ������ 0 awindow aWindow�� 0 atty aTty��  � �������������� 0 awindow aWindow�� 0 atty aTty�� 0 currentwindow currentWindow�� 0 thewindowid theWindowId�� 0 
currenttab 
currentTab�� 0 thetty theTty� ���������������������
�� 
cwin
�� 
kocl
�� 
cobj
�� .corecnte****       ****
�� 
ID  
�� 
ttab
�� 
ttty
�� 
busy
�� 
bool
�� 
null�� c� \ Y*�-[��l kh ��,E�O��  8 2��-[��l kh ��,E�O�� 	 	��,e�& �Y h[OY��Y h[OY��UO�� ������������� 0 window_of_tab  �� ����� �  ���� 0 atty aTty��  � ���������� 0 atty aTty�� 0 currentwindow currentWindow�� 0 
currenttab 
currentTab�� 0 thetty theTty� ���������������
�� 
cwin
�� 
kocl
�� 
cobj
�� .corecnte****       ****
�� 
ttab
�� 
ttty
�� 
null�� I� B ?*�-[��l kh  (��-[��l kh ��,E�O��  �Y h[OY��[OY��UO�ascr  ��ޭ