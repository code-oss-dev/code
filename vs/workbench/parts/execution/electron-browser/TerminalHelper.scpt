FasdUAS 1.101.10   ��   ��    k             l     ��  ��    C =-------------------------------------------------------------     � 	 	 z - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -   
  
 l     ��  ��    @ : Copyright (C) Microsoft Corporation. All rights reserved.     �   t   C o p y r i g h t   ( C )   M i c r o s o f t   C o r p o r a t i o n .   A l l   r i g h t s   r e s e r v e d .      l     ��  ��    C =-------------------------------------------------------------     �   z - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -      l     ��������  ��  ��        l     ��  ��    e _ the following two properties are persisted across different runs of this TerminalHelper script     �   �   t h e   f o l l o w i n g   t w o   p r o p e r t i e s   a r e   p e r s i s t e d   a c r o s s   d i f f e r e n t   r u n s   o f   t h i s   T e r m i n a l H e l p e r   s c r i p t      l     ��  ��    B < they are used to reuse the same terminal across invocations     �   x   t h e y   a r e   u s e d   t o   r e u s e   t h e   s a m e   t e r m i n a l   a c r o s s   i n v o c a t i o n s     !   j     �� "�� 0 lasttty lastTty " m     ��
�� 
msng !  # $ # j    �� %�� 0 lastwindowid lastWindowID % m    ��
�� 
msng $  & ' & l     ��������  ��  ��   '  ( ) ( i    	 * + * I     �� ,��
�� .aevtoappnull  �   � **** , o      ���� 0 argv  ��   + k    � - -  . / . l     ��������  ��  ��   /  0 1 0 r      2 3 2 m     ��
�� 
msng 3 o      ���� 0 window_title   1  4 5 4 r     6 7 6 m    ��
�� 
msng 7 o      ���� 0 working_dir   5  8 9 8 r     : ; : m    	 < < � = =   ; o      ���� 0 runtime   9  > ? > r     @ A @ m     B B � C C   A o      ���� 0 runtimeargs runtimeArgs ?  D E D r     F G F m    ��
�� 
msng G o      ���� 0 runtimename runtimeName E  H I H r     J K J m     L L � M M   K o      ���� 0 program   I  N O N r     P Q P m     R R � S S   Q o      ���� 0 programargs programArgs O  T U T r     V W V m     X X � Y Y   W o      ���� 0 env_vars   U  Z [ Z r     # \ ] \ m     !��
�� boovfals ] o      ���� 0 activate_console   [  ^ _ ^ l  $ $��������  ��  ��   _  ` a ` Y   $] b�� c d�� b k   2X e e  f g f r   2 < h i h l  2 8 j���� j n   2 8 k l k 4   3 8�� m
�� 
cobj m o   6 7���� 0 i   l o   2 3���� 0 argv  ��  ��   i o      ���� 0 a   g  n o n l  = =��������  ��  ��   o  p q p Z   =V r s t�� r =   = D u v u o   = @���� 0 a   v m   @ C w w � x x  - w s k   G Y y y  z { z r   G L | } | [   G J ~  ~ o   G H���� 0 i    m   H I����  } o      ���� 0 i   {  ��� � r   M Y � � � n   M W � � � 1   S W��
�� 
strq � l  M S ����� � n   M S � � � 4   N S�� �
�� 
cobj � o   Q R���� 0 i   � o   M N���� 0 argv  ��  ��   � o      ���� 0 working_dir  ��   t  � � � =   \ c � � � o   \ _���� 0 a   � m   _ b � � � � �  - r �  � � � k   f x � �  � � � r   f k � � � [   f i � � � o   f g���� 0 i   � m   g h����  � o      ���� 0 i   �  ��� � r   l x � � � n   l v � � � 1   r v��
�� 
strq � l  l r ����� � n   l r � � � 4   m r�� �
�� 
cobj � o   p q���� 0 i   � o   l m���� 0 argv  ��  ��   � o      ���� 0 runtime  ��   �  � � � =   { � � � � o   { ~���� 0 a   � m   ~ � � � � � �  - r a �  � � � k   � � � �  � � � r   � � � � � [   � � � � � o   � ����� 0 i   � m   � �����  � o      ���� 0 i   �  ��� � r   � � � � � b   � � � � � b   � � � � � o   � ����� 0 runtimeargs runtimeArgs � m   � � � � � � �    � n   � � � � � 1   � ���
�� 
strq � l  � � ����� � n   � � � � � 4   � ��� �
�� 
cobj � o   � ����� 0 i   � o   � ����� 0 argv  ��  ��   � o      ���� 0 runtimeargs runtimeArgs��   �  � � � =   � � � � � o   � ����� 0 a   � m   � � � � � � �  - r n �  � � � k   � � � �  � � � r   � � � � � [   � � � � � o   � ����� 0 i   � m   � �����  � o      ���� 0 i   �  ��� � r   � � � � � l  � � ����� � n   � � � � � 4   � ��� �
�� 
cobj � o   � ����� 0 i   � o   � ����� 0 argv  ��  ��   � o      ���� 0 runtimename runtimeName��   �  � � � =   � � � � � o   � ����� 0 a   � m   � � � � � � �  - p �  � � � k   � � � �  � � � r   � � � � � [   � � � � � o   � ����� 0 i   � m   � �����  � o      ���� 0 i   �  ��� � r   � � � � � n   � � � � � 1   � ���
�� 
strq � l  � � ����� � n   � � � � � 4   � ��� �
�� 
cobj � o   � ����� 0 i   � o   � ����� 0 argv  ��  ��   � o      ���� 0 program  ��   �  � � � =   � � � � � o   � ����� 0 a   � m   � � � � � � �  - p a �  � � � k   � � � �  � � � r   � � � � � [   � � � � � o   � ����� 0 i   � m   � �����  � o      ���� 0 i   �  ��� � r   � � � � � b   � � �  � b   � � o   � ����� 0 programargs programArgs m   � � �     n   � � 1   � ���
�� 
strq l  � ����� n   � �	 4   � ���

�� 
cobj
 o   � ����� 0 i  	 o   � ����� 0 argv  ��  ��   � o      ���� 0 programargs programArgs��   �  =   � o   ����� 0 a   m   �  - e  k  	!  r  	 [  	 o  	
���� 0 i   m  
����  o      ���� 0 i   �� r  ! b   b    o  �� 0 env_vars    m  !! �""    n  #$# 1  �~
�~ 
strq$ l %�}�|% n  &'& 4  �{(
�{ 
cobj( o  �z�z 0 i  ' o  �y�y 0 argv  �}  �|   o      �x�x 0 env_vars  ��   )*) =  $++,+ o  $'�w�w 0 a  , m  '*-- �..  - t* /0/ k  .<11 232 r  .3454 [  .1676 o  ./�v�v 0 i  7 m  /0�u�u 5 o      �t�t 0 i  3 8�s8 r  4<9:9 l 4:;�r�q; n  4:<=< 4  5:�p>
�p 
cobj> o  89�o�o 0 i  = o  45�n�n 0 argv  �r  �q  : o      �m�m 0 window_title  �s  0 ?@? =  ?FABA o  ?B�l�l 0 a  B m  BECC �DD  - a@ E�kE k  IRFF GHG r  INIJI [  ILKLK o  IJ�j�j 0 i  L m  JK�i�i J o      �h�h 0 i  H M�gM r  ORNON m  OP�f
�f boovtrueO o      �e�e 0 activate_console  �g  �k  ��   q P�dP l WW�c�b�a�c  �b  �a  �d  �� 0 i   c m   ' (�`�`  d l  ( -Q�_�^Q I  ( -�]R�\
�] .corecnte****       ****R o   ( )�[�[ 0 argv  �\  �_  �^  ��   a STS l ^^�Z�Y�X�Z  �Y  �X  T UVU r  ^eWXW m  ^aYY �ZZ  X o      �W�W 0 cmd  V [\[ Z  f}]^�V�U] >  fi_`_ o  fg�T�T 0 working_dir  ` m  gh�S
�S 
msng^ r  lyaba b  lucdc b  lqefe m  logg �hh  c d  f o  op�R�R 0 working_dir  d m  qtii �jj  ;  b o      �Q�Q 0 cmd  �V  �U  \ klk l ~~�P�O�N�P  �O  �N  l mnm Z  ~�op�M�Lo >  ~�qrq o  ~�K�K 0 env_vars  r m  �ss �tt  p r  ��uvu b  ��wxw b  ��yzy o  ���J�J 0 cmd  z m  ��{{ �||  e n vx o  ���I�I 0 env_vars  v o      �H�H 0 cmd  �M  �L  n }~} l ���G�F�E�G  �F  �E  ~ � r  ����� b  ����� b  ����� o  ���D�D 0 cmd  � m  ���� ���   � o  ���C�C 0 runtime  � o      �B�B 0 cmd  � ��� Z  �����A�@� >  ����� o  ���?�? 0 runtimeargs runtimeArgs� m  ���� ���  � r  ����� b  ����� o  ���>�> 0 cmd  � o  ���=�= 0 runtimeargs runtimeArgs� o      �<�< 0 cmd  �A  �@  � ��� l ���;�:�9�;  �:  �9  � ��� r  ����� b  ����� b  ����� o  ���8�8 0 cmd  � m  ���� ���   � o  ���7�7 0 program  � o      �6�6 0 cmd  � ��� Z  �����5�4� >  ����� o  ���3�3 0 programargs programArgs� m  ���� ���  � r  ����� b  ����� o  ���2�2 0 cmd  � o  ���1�1 0 programargs programArgs� o      �0�0 0 cmd  �5  �4  � ��� l ���/�.�-�/  �.  �-  � ��� O  ����� k  ���� ��� l ���,�+�*�,  �+  �*  � ��� Z  �����)�(� o  ���'�' 0 activate_console  � I ���&�%�$
�& .miscactvnull��� ��� null�%  �$  �)  �(  � ��� l ���#�"�!�#  �"  �!  � ��� r  ���� n ���� I  �� ���  &0 findnonbusyttytab findNonBusyTtyTab� ��� o  ���� 0 lastwindowid lastWindowID� ��� o  ���� 0 lasttty lastTty�  �  �  f  ��� o      �� 0 	targettab 	targetTab� ��� l ����  �  �  � ��� Z  ������ >  ��� o  �� 0 	targettab 	targetTab� m  �
� 
null� k  )�� ��� l ����  �   reuse terminal   � ���    r e u s e   t e r m i n a l� ��� l ���� r  ��� m  �
� boovtrue� n      ��� 1  �
� 
tbsl� o  �� 0 	targettab 	targetTab�   bring tab to front   � ��� &   b r i n g   t a b   t o   f r o n t� ��� I )���
� .coredoscnull��� ��� ctxt� o  �� 0 cmd  � ���
� 
kfil� o  "%�� 0 	targettab 	targetTab�  �  �  � k  ,��� ��� l ,,�
���
  �   create new terminal   � ��� (   c r e a t e   n e w   t e r m i n a l� ��� r  ,7��� l ,3��	�� I ,3���
� .coredoscnull��� ��� ctxt� o  ,/�� 0 cmd  �  �	  �  � o      �� 0 	targettab 	targetTab� ��� l 88����  �  �  � ��� l 88� ���   � . ( remember tty and window ID for next run   � ��� P   r e m e m b e r   t t y   a n d   w i n d o w   I D   f o r   n e x t   r u n� ��� r  8E��� l 8?������ n  8?��� 1  ;?��
�� 
ttty� o  8;���� 0 	targettab 	targetTab��  ��  � o      ���� 0 lasttty lastTty� ��� r  FT� � n FP I  GP������ 0 window_of_tab   �� o  GL���� 0 lasttty lastTty��  ��    f  FG  o      ���� 0 	thewindow 	theWindow�  Z  Uw���� >  U\	
	 o  UX���� 0 	thewindow 	theWindow
 m  X[��
�� 
null r  _s n  _m 1  im��
�� 
ID   n _i I  `i������ 0 window_of_tab   �� o  `e���� 0 lasttty lastTty��  ��    f  _` o      ���� 0 lastwindowid lastWindowID��  ��    l xx��������  ��  ��   �� Z  x����� >  x{ o  xy���� 0 window_title   m  yz��
�� 
msng k  ~�  r  ~� m  ~��
�� boovtrue n        1  ����
�� 
tdct  o  ����� 0 	targettab 	targetTab !"! r  ��#$# m  ����
�� boovfals$ n      %&% 1  ����
�� 
tdsp& o  ������ 0 	targettab 	targetTab" '(' l ����)*��  ) : 4set title displays device name of targetTab to false   * �++ h s e t   t i t l e   d i s p l a y s   d e v i c e   n a m e   o f   t a r g e t T a b   t o   f a l s e( ,��, r  ��-.- o  ������ 0 window_title  . n      /0/ 1  ����
�� 
titl0 o  ������ 0 	targettab 	targetTab��  ��  ��  ��  � 121 l ����������  ��  ��  2 3��3 Z  ��45����4 >  ��676 o  ������ 0 runtimename runtimeName7 m  ����
�� 
msng5 k  ��88 9:9 l ����;<��  ; g a find the process with name 'runtimeName' that runs under the given tty and return its process id   < �== �   f i n d   t h e   p r o c e s s   w i t h   n a m e   ' r u n t i m e N a m e '   t h a t   r u n s   u n d e r   t h e   g i v e n   t t y   a n d   r e t u r n   i t s   p r o c e s s   i d: >?> l ����������  ��  ��  ? @��@ U  ��ABA k  ��CC DED l ����������  ��  ��  E FGF I ����H��
�� .sysodelanull��� ��� nmbrH m  ��II ?�      ��  G JKJ l ����������  ��  ��  K LML r  ��NON I ����P��
�� .sysoexecTEXT���     TEXTP b  ��QRQ b  ��STS b  ��UVU b  ��WXW m  ��YY �ZZ  p s   - c   - t  X o  ������ 0 lasttty lastTtyV m  ��[[ �\\    |   a w k   ' $ 4 = = "T o  ������ 0 runtimename runtimeNameR m  ��]] �^^  "   {   p r i n t   $ 1   } '��  O o      ���� 0 pid  M _`_ l ����������  ��  ��  ` aba Z  ��cd����c >  ��efe o  ������ 0 pid  f m  ��gg �hh  d L  ��ii o  ������ 0 pid  ��  ��  b j��j l ����������  ��  ��  ��  B m  ������ 
��  ��  ��  ��  � m  ��kk�                                                                                      @ alis    N  HD                         Η��H+   ���Terminal.app                                                    ����5B�        ����  	                	Utilities     Η��      �5&h     ��� ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��  � lml l ����������  ��  ��  m non L  ��pp m  ������  o q��q l ����������  ��  ��  ��   ) rsr l     ��������  ��  ��  s tut i   
 vwv I      ��x���� &0 findnonbusyttytab findNonBusyTtyTabx yzy o      ���� 0 awindow aWindowz {��{ o      ���� 0 atty aTty��  ��  w k     b|| }~} O     _� X    ^����� k    Y�� ��� r    ��� n    ��� 1    ��
�� 
ID  � o    ���� 0 currentwindow currentWindow� o      ���� 0 thewindowid theWindowId� ���� Z    Y������� =    ��� o    ���� 0 thewindowid theWindowId� o    ���� 0 awindow aWindow� X   " U����� k   4 P�� ��� r   4 9��� n   4 7��� 1   5 7��
�� 
ttty� o   4 5���� 0 
currenttab 
currentTab� o      ���� 0 thetty theTty� ���� Z   : P������� F   : G��� l  : =������ =   : =��� o   : ;���� 0 thetty theTty� o   ; <���� 0 atty aTty��  ��  � l  @ E������ >  @ E��� n   @ C��� 1   A C��
�� 
busy� o   @ A���� 0 
currenttab 
currentTab� m   C D��
�� boovtrue��  ��  � L   J L�� o   J K���� 0 
currenttab 
currentTab��  ��  ��  �� 0 
currenttab 
currentTab� n   % (��� 2  & (��
�� 
ttab� o   % &���� 0 currentwindow currentWindow��  ��  ��  �� 0 currentwindow currentWindow� 2   
��
�� 
cwin� m     ���                                                                                      @ alis    N  HD                         Η��H+   ���Terminal.app                                                    ����5B�        ����  	                	Utilities     Η��      �5&h     ��� ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��  ~ ���� L   ` b�� m   ` a��
�� 
null��  u ��� l     ��������  ��  ��  � ��� i    ��� I      ������ 0 window_of_tab  � ��~� o      �}�} 0 atty aTty�~  �  � k     H�� ��� O     E��� X    D��|�� X    ?��{�� k   ( :�� ��� r   ( -��� n   ( +��� 1   ) +�z
�z 
ttty� o   ( )�y�y 0 
currenttab 
currentTab� o      �x�x 0 thetty theTty� ��w� Z   . :���v�u� l  . 1��t�s� =   . 1��� o   . /�r�r 0 thetty theTty� o   / 0�q�q 0 atty aTty�t  �s  � L   4 6�� o   4 5�p�p 0 currentwindow currentWindow�v  �u  �w  �{ 0 
currenttab 
currentTab� n    ��� 2   �o
�o 
ttab� o    �n�n 0 currentwindow currentWindow�| 0 currentwindow currentWindow� 2   
�m
�m 
cwin� m     ���                                                                                      @ alis    N  HD                         Η��H+   ���Terminal.app                                                    ����5B�        ����  	                	Utilities     Η��      �5&h     ��� ���  (HD:Applications: Utilities: Terminal.app    T e r m i n a l . a p p    H D  #Applications/Utilities/Terminal.app   / ��  � ��l� L   F H�� m   F G�k
�k 
null�l  � ��� l     �j�i�h�j  �i  �h  � ��g� l     �f�e�d�f  �e  �d  �g       �c���b��������a����`������_�c  � �^�]�\�[�Z�Y�X�W�V�U�T�S�R�Q�P�O�N�M�L�K�^ 0 lasttty lastTty�] 0 lastwindowid lastWindowID
�\ .aevtoappnull  �   � ****�[ &0 findnonbusyttytab findNonBusyTtyTab�Z 0 window_of_tab  �Y 0 window_title  �X 0 working_dir  �W 0 runtime  �V 0 runtimeargs runtimeArgs�U 0 runtimename runtimeName�T 0 program  �S 0 programargs programArgs�R 0 env_vars  �Q 0 activate_console  �P 0 a  �O 0 cmd  �N 0 	targettab 	targetTab�M 0 	thewindow 	theWindow�L 0 pid  �K  � ���  / d e v / t t y s 0 1 7�b�� �J +�I�H���G
�J .aevtoappnull  �   � ****�I 0 argv  �H  � �F�E�F 0 argv  �E 0 i  � A�D�C�B <�A B�@�? L�> R�= X�<�;�:�9�8 w�7 � � � � � �!-CY�6gis{����k�5�4�3�2�1�0�/�.�-�,�+�*�)�(�'I�&Y[]�%�$g
�D 
msng�C 0 window_title  �B 0 working_dir  �A 0 runtime  �@ 0 runtimeargs runtimeArgs�? 0 runtimename runtimeName�> 0 program  �= 0 programargs programArgs�< 0 env_vars  �; 0 activate_console  
�: .corecnte****       ****
�9 
cobj�8 0 a  
�7 
strq�6 0 cmd  
�5 .miscactvnull��� ��� null�4 &0 findnonbusyttytab findNonBusyTtyTab�3 0 	targettab 	targetTab
�2 
null
�1 
tbsl
�0 
kfil
�/ .coredoscnull��� ��� ctxt
�. 
ttty�- 0 window_of_tab  �, 0 	thewindow 	theWindow
�+ 
ID  
�* 
tdct
�) 
tdsp
�( 
titl�' 

�& .sysodelanull��� ��� nmbr
�% .sysoexecTEXT���     TEXT�$ 0 pid  �G��E�O�E�O�E�O�E�O�E�O�E�O�E�O�E�OfE�O8k�j kh �a �/E` O_ a   �kE�O�a �/a ,E�Y �_ a   �kE�O�a �/a ,E�Y �_ a   �kE�O�a %�a �/a ,%E�Y �_ a   �kE�O�a �/E�Y �_ a   �kE�O�a �/a ,E�Y ~_ a   �kE�O�a %�a �/a ,%E�Y Y_ a   �kE�O�a %�a �/a ,%E�Y 4_ a   �kE�O�a �/E�Y _ a   �kE�OeE�Y hOP[OY��Oa E`  O�� a !�%a "%E`  Y hO�a # _  a $%�%E`  Y hO_  a %%�%E`  O�a & _  �%E`  Y hO_  a '%�%E`  O�a ( _  �%E`  Y hOa )� 
*j *Y hO)b  b   l+ +E` ,O_ ,a - e_ ,a .,FO_  a /_ ,l 0Y u_  j 0E` ,O_ ,a 1,Ec   O)b   k+ 2E` 3O_ 3a - )b   k+ 2a 4,Ec  Y hO�� "e_ ,a 5,FOf_ ,a 6,FO�_ ,a 7,FY hO�� K Ea 8kha 9j :Oa ;b   %a <%�%a =%j >E` ?O_ ?a @ 	_ ?Y hOP[OY��Y hUOjOP� �#w�"�!��� �# &0 findnonbusyttytab findNonBusyTtyTab�" ��� �  ��� 0 awindow aWindow� 0 atty aTty�!  � ������� 0 awindow aWindow� 0 atty aTty� 0 currentwindow currentWindow� 0 thewindowid theWindowId� 0 
currenttab 
currentTab� 0 thetty theTty� �����������
� 
cwin
� 
kocl
� 
cobj
� .corecnte****       ****
� 
ID  
� 
ttab
� 
ttty
� 
busy
� 
bool
� 
null�  c� \ Y*�-[��l kh ��,E�O��  8 2��-[��l kh ��,E�O�� 	 	��,e�& �Y h[OY��Y h[OY��UO�� ����
���	� 0 window_of_tab  � ��� �  �� 0 atty aTty�
  � ����� 0 atty aTty� 0 currentwindow currentWindow� 0 
currenttab 
currentTab� 0 thetty theTty� ���� ��������
� 
cwin
� 
kocl
�  
cobj
�� .corecnte****       ****
�� 
ttab
�� 
ttty
�� 
null�	 I� B ?*�-[��l kh  (��-[��l kh ��,E�O��  �Y h[OY��[OY��UO�� ��� " V S   C o d e   C o n s o l e   2� ��� J ' / U s e r s / w e i n a n d / M S / P r o j e c t s / D e b u g g e r '� ��� * ' / u s r / l o c a l / b i n / n o d e '� ��� >   ' - - d e b u g - b r k = 2 0 8 4 9 '   ' - - n o l a z y '
�a 
msng� ��� Z ' / U s e r s / w e i n a n d / M S / P r o j e c t s / D e b u g g e r / t e s t . j s '� ��� 4   ' f o o '   ' b a r '   ' h e l l o   w o r l d '� ��� N   ' U S E R = w e i n a n d '   ' S T R E E T = H a d l a u b s t r .   7 0 '
�` boovfals� ��� * S T R E E T = H a d l a u b s t r .   7 0� ���� c d   ' / U s e r s / w e i n a n d / M S / P r o j e c t s / D e b u g g e r ' ;   e n v   ' U S E R = w e i n a n d '   ' S T R E E T = H a d l a u b s t r .   7 0 '   ' / u s r / l o c a l / b i n / n o d e '   ' - - d e b u g - b r k = 2 0 8 4 9 '   ' - - n o l a z y '   ' / U s e r s / w e i n a n d / M S / P r o j e c t s / D e b u g g e r / t e s t . j s '   ' f o o '   ' b a r '   ' h e l l o   w o r l d '� �� ������ k������
�� 
cwin���
�� kfrmID  
�� 
ttab�� � �� ������ ���
�� 
cwin
�� 
cobj�� � ��� 
 3 1 2 7 0�_   ascr  ��ޭ