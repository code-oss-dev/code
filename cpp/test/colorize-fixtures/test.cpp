// classes example
#include <iostream>
using namespace std;

#define EXTERN_C extern "C"

class Rectangle {
    int width, height;
  public:
    void set_values (int,int);
    int area() {return width*height;}
};

void Rectangle::set_values (int x, int y) {
  width = x;
  height = y;
}

int main () {
  Rectangle rect;
  rect.set_values (3,4);
  cout << "area: " << rect.area();
  Task<ANY_OUTPUT_TYPE, ANY_INPUT_TYPE>::links_to;
  return 0;
}